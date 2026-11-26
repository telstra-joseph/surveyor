import { validCoordinates } from './geo.js';

const number = text => {
  const value = Number(text);
  return Number.isFinite(value) ? value : NaN;
};

// MapInfo raster TAB: control points pair world coordinates with image pixels.
export function parseTab(text) {
  const image = /^\s*File\s+"([^"]+)"/im.exec(text)?.[1];
  if (!image) throw new Error('The TAB file does not name a floor-plan image.');
  if (!/^\s*Type\s+"RASTER"/im.test(text)) throw new Error('The TAB file is not a raster floor plan.');
  const controls = [...text.matchAll(/\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)/g)]
    .map(([, x, y, px, py]) => ({ world: [number(x), number(y)], pixel: [number(px), number(py)] }))
    .filter(({ world, pixel }) => [...world, ...pixel].every(Number.isFinite));
  if (controls.length < 3) throw new Error('The TAB file needs at least three control points.');
  const coordSys = /^\s*CoordSys\s+(.+)$/im.exec(text)?.[1].trim() || '';
  const earth = /^Earth\b/i.test(coordSys);
  if (earth && !/^Earth\s+Projection\s+1\s*,/i.test(coordSys)) {
    throw new Error('Only longitude/latitude (Projection 1) georeferenced TAB files are supported.');
  }
  const units = /^\s*Units\s+"([^"]+)"/im.exec(text)?.[1] || (earth ? 'degree' : 'm');
  return { image, controls, earth, units };
}

// Nemo marker file: marker positions in walk order. Values are lon = x and lat = y in the plan's units.
export function parseMrk(text) {
  const sections = new Map();
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      section = header[1].trim().toLowerCase();
      if (!sections.has(section)) sections.set(section, {});
      continue;
    }
    const pair = /^([^=]+)=(.*)$/.exec(line);
    if (pair && section) sections.get(section)[pair[1].trim().toLowerCase()] = pair[2].trim();
  }
  const markers = [...sections].flatMap(([name, values]) => {
    const order = /^marker(\d+)$/.exec(name)?.[1];
    if (order === undefined) return [];
    const x = number(values.lon), y = number(values.lat);
    return Number.isFinite(x) && Number.isFinite(y) ? [{ order: Number(order), point: [x, y] }] : [];
  }).sort((a, b) => a.order - b.order).map(({ point }) => point);
  return {
    name: sections.get('datafile')?.filename || '',
    system: (sections.get('coordinateformat')?.coordinatesystem || '').toLowerCase(),
    markers,
  };
}

function solve3(m, v) {
  const det = a => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
    + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
  return [0, 1, 2].map(column => det(m.map((row, index) => row.map((value, c) => c === column ? v[index] : value))) / d);
}

// Least-squares affine transform through the control points, in both directions.
export function affineTransform(controls) {
  const fit = (from, to) => {
    // Centre and scale the inputs: raw or tiny lon/lat spans make the normal equations lose their precision.
    const mean = [0, 1].map(axis => controls.reduce((sum, control) => sum + control[from][axis], 0) / controls.length);
    const scale = Math.max(...controls.flatMap(control => control[from].map((value, axis) => Math.abs(value - mean[axis])))) || 1;
    const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], atx = [0, 0, 0], aty = [0, 0, 0];
    for (const control of controls) {
      const [u, v] = control[from], [x, y] = control[to], row = [(u - mean[0]) / scale, (v - mean[1]) / scale, 1];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) ata[i][j] += row[i] * row[j];
        atx[i] += row[i] * x;
        aty[i] += row[i] * y;
      }
    }
    const fx = solve3(ata, atx), fy = solve3(ata, aty);
    if (!fx || !fy) throw new Error('The TAB control points do not define a usable floor-plan transform.');
    return ([u, v]) => {
      const du = (u - mean[0]) / scale, dv = (v - mean[1]) / scale;
      return [fx[0] * du + fx[1] * dv + fx[2], fy[0] * du + fy[1] * dv + fy[2]];
    };
  };
  return { toWorld: fit('pixel', 'world'), toPixel: fit('world', 'pixel') };
}

const inside = ([x, y], width, height) => x >= -0.05 * width && x <= 1.05 * width && y >= -0.05 * height && y <= 1.05 * height;

// Floor plans without georeferencing use a planar map where north is up, so the TAB y axis is flipped.
export function createPlan({ id, tab, mrk, width, height, image, imageWidth = width, imageHeight = height }) {
  const { toWorld, toPixel } = affineTransform(tab.controls);
  const planar = !tab.earth;
  const toMap = planar ? ([x, y]) => [x, -y] : point => point;
  const corners = [[0, 0], [width, 0], [0, height]].map(pixel => toMap(toWorld(pixel)));
  let markers = [];
  if (mrk?.markers.length) {
    if (planar) {
      markers = mrk.markers.map(toMap);
    } else {
      // Georeferenced MRKs usually hold lon/lat; metric ones hold image pixels. Prefer the reading that lands on the plan.
      const asWorld = mrk.markers.filter(point => validCoordinates(...point) && inside(toPixel(point), width, height)).length;
      const asPixel = mrk.markers.filter(point => inside(point, width, height)).length;
      const pixels = mrk.system === 'metric' ? asPixel >= asWorld : asPixel > asWorld;
      markers = pixels ? mrk.markers.map(toWorld) : mrk.markers;
    }
  }
  return {
    id, name: tab.image.replace(/\.[^.]+$/, ''), imageName: tab.image, markerFile: mrk?.name || '',
    planar, units: tab.units, width, height, image, imageWidth, imageHeight, corners, markers,
  };
}

function pathLength(a, b, planar) {
  if (planar) return Math.hypot(b[0] - a[0], b[1] - a[1]);
  const scale = Math.cos((a[1] + b[1]) * Math.PI / 360);
  return Math.hypot((b[0] - a[0]) * scale, b[1] - a[1]);
}

// Spread samples evenly by distance along the marker path, in order.
export function spreadAlongPath(path, count, planar) {
  if (!count || !path.length) return [];
  if (path.length === 1 || count === 1) return Array.from({ length: count }, () => [...path[0]]);
  const lengths = [0];
  for (let index = 1; index < path.length; index++) lengths.push(lengths[index - 1] + pathLength(path[index - 1], path[index], planar));
  const total = lengths.at(-1);
  if (!total) return Array.from({ length: count }, () => [...path[0]]);
  const points = [];
  let segment = 1;
  for (let index = 0; index < count; index++) {
    const target = total * index / (count - 1);
    while (segment < path.length - 1 && lengths[segment] < target) segment++;
    const span = lengths[segment] - lengths[segment - 1];
    const t = span ? (target - lengths[segment - 1]) / span : 0;
    const [a, b] = [path[segment - 1], path[segment]];
    points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return points;
}

export function positionSurvey(survey, plan) {
  const rows = Object.keys(survey.geography).map(Number).sort((a, b) => a - b);
  const geography = {};
  if (plan.markers.length) {
    const points = spreadAlongPath(plan.markers, rows.length, plan.planar);
    rows.forEach((row, index) => { geography[row] = { ...survey.geography[row], coords: points[index] }; });
  } else {
    for (const row of rows) {
      const entry = survey.geography[row];
      const source = plan.planar ? entry.xy || entry.coords : entry.coords;
      const coords = !source ? null : plan.planar ? [source[0], -source[1]] : source;
      geography[row] = { ...entry, coords };
    }
  }
  const metrics = survey.metrics.map(metric => {
    const located = new Set();
    for (const points of [metric.series, metric.geoCategories || []]) {
      for (const [row] of points) if (geography[row]?.coords) located.add(row);
    }
    return { ...metric, geoCount: located.size };
  });
  return { ...survey, geography, metrics };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { affineTransform, createPlan, parseMrk, parseTab, positionSurvey, spreadAlongPath } from '../src/indoor.js';

const tab = (points, coordSys, units) => `!table
Definition Table
  File "Floor.bmp"
  Type "RASTER"
${points.map(([world, pixel], index) => `  (${world}) (${pixel}) Label "Pt ${index + 1}"`).join(',\n')}
  CoordSys ${coordSys}
  Units "${units}"`;

const mrk = (system, markers) => `[Datafile]
filename=Indoor walk
[CoordinateFormat]
coordinatesystem=${system}
[markercount]
markers=${markers.length}
${markers.map(([lon, lat], index) => `[marker${index}]\nlat=${lat}\nlon=${lon}`).reverse().join('\n')}`;

// A rotated plan: image x runs south-east, image y runs south-west.
const rotated = tab([
  ['151.2072,-33.8623', '0,0'], ['151.2076,-33.8628', '1000,0'], ['151.2066,-33.8627', '0,800'], ['151.2070,-33.8632', '1000,800'],
], 'Earth Projection 1, 104', 'degree');
const local = tab([['0,0', '0,0'], ['50,0', '500,0'], ['0,30', '0,300']], 'NonEarth Units "m"', 'm');

test('reads rotated georeferenced TAB files and their affine corners', () => {
  const parsed = parseTab(rotated);
  assert.equal(parsed.image, 'Floor.bmp');
  assert.equal(parsed.earth, true);
  assert.equal(parsed.controls.length, 4);
  const { toWorld, toPixel } = affineTransform(parsed.controls);
  assert.deepEqual(toWorld([1000, 800]).map(value => +value.toFixed(6)), [151.207, -33.8632]);
  assert.deepEqual(toPixel([151.2076, -33.8628]).map(value => Math.round(value) + 0), [1000, 0]);
  const plan = createPlan({ id: 'p', tab: parsed, width: 1000, height: 800, image: 'data:', imageWidth: 500, imageHeight: 400 });
  assert.equal(plan.planar, false);
  assert.deepEqual(plan.corners.map(point => point.map(value => +value.toFixed(6))),
    [[151.2072, -33.8623], [151.2076, -33.8628], [151.2066, -33.8627]]);
});

test('rejects TAB files without a raster or enough control points', () => {
  assert.throws(() => parseTab(rotated.replace('RASTER', 'VECTOR')), /not a raster/);
  assert.throws(() => parseTab(tab([['0,0', '0,0'], ['1,0', '1,0']], 'NonEarth Units "m"', 'm')), /three control points/);
  assert.throws(() => parseTab(rotated.replace('Projection 1, 104', 'Projection 8, 104')), /Projection 1/);
});

test('orders markers and detects lon/lat, pixel and planar marker units', () => {
  const latlon = parseMrk(mrk('latlon', [[151.2071, -33.8625], [151.2072, -33.8627]]));
  assert.equal(latlon.name, 'Indoor walk');
  assert.deepEqual(latlon.markers, [[151.2071, -33.8625], [151.2072, -33.8627]]);
  const parsed = parseTab(rotated);
  const geo = createPlan({ id: 'g', tab: parsed, mrk: latlon, width: 1000, height: 800 });
  assert.deepEqual(geo.markers, latlon.markers);
  const pixels = createPlan({ id: 'x', tab: parsed, mrk: parseMrk(mrk('metric', [[0, 0], [1000, 800]])), width: 1000, height: 800 });
  assert.deepEqual(pixels.markers.map(point => point.map(value => +value.toFixed(6))), [[151.2072, -33.8623], [151.207, -33.8632]]);
  // NonEarth MRKs hold plan units even when flagged latlon; y is flipped so north stays up.
  const planar = createPlan({ id: 'm', tab: parseTab(local), mrk: parseMrk(mrk('latlon', [[10, 5], [40, 25]])), width: 500, height: 300 });
  assert.equal(planar.planar, true);
  assert.deepEqual(planar.markers, [[10, -5], [40, -25]]);
  assert.deepEqual(planar.corners.map(point => point.map(value => +value.toFixed(6) + 0)), [[0, 0], [50, 0], [0, -30]]);
});

test('spreads samples evenly by distance along the marker path', () => {
  assert.deepEqual(spreadAlongPath([[0, 0], [10, 0], [10, 10]], 5, true), [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]]);
  assert.deepEqual(spreadAlongPath([[3, 4]], 2, true), [[3, 4], [3, 4]]);
  assert.deepEqual(spreadAlongPath([[0, 0], [0, 0]], 2, true), [[0, 0], [0, 0]]);
});

const survey = {
  filename: 'walk.xlsx',
  geography: {
    1: { coords: null, day: '2026-01-01', radio: {} },
    2: { coords: [151.2071, -33.8625], day: '2026-01-01', radio: {} },
    3: { coords: null, xy: [20, 10], day: '2026-01-01', radio: {} },
  },
  metrics: [{ key: 'RSRP', series: [[1, -80], [2, -90], [3, -100]], geoCount: 1 }],
};

test('positions every workbook row along markers, or falls back to workbook positions', () => {
  const tabbed = parseTab(local);
  const marked = positionSurvey(survey, createPlan({ id: 'm', tab: tabbed, mrk: parseMrk(mrk('metric', [[0, 5], [20, 5]])), width: 500, height: 300 }));
  assert.deepEqual([1, 2, 3].map(row => marked.geography[row].coords), [[0, -5], [10, -5], [20, -5]]);
  assert.equal(marked.metrics[0].geoCount, 3);
  assert.equal(survey.metrics[0].geoCount, 1, 'the source survey is not changed');

  const planar = positionSurvey(survey, createPlan({ id: 'p', tab: tabbed, width: 500, height: 300 }));
  assert.deepEqual([1, 2, 3].map(row => planar.geography[row].coords), [null, [151.2071, 33.8625], [20, -10]]);
  const geo = positionSurvey(survey, createPlan({ id: 'g', tab: parseTab(rotated), width: 1000, height: 800 }));
  assert.deepEqual([1, 2, 3].map(row => geo.geography[row].coords), [null, [151.2071, -33.8625], null]);
  assert.equal(geo.metrics[0].geoCount, 1);
});

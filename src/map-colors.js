import { format, isPciKpi, metricName, technologyModeKey } from './charts.js';
import { isSinrKpi } from './map-thresholds.js';

const palette = [
  '#0D54FF', '#D24C11', '#008060', '#972C94', '#C99D00', '#1A2E61', '#DB4380', '#42ADC3',
  '#615000', '#BDE552', '#9E261F', '#AA8DF3', '#134829', '#F38D52', '#306F96', '#EDAFD9',
];
const gradient = { low: '#0D54FF', high: '#D24C11', single: '#0055B8', missing: '#717888' };
const squaredDistance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const hex = channels => `#${channels.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const rgb = color => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));

function oklab(color) {
  const [r, g, b] = rgb(color).map(value => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .808675766 * s];
}

function candidates(count) {
  const colors = new Set(palette);
  if (count > colors.size) {
    const steps = Math.min(12, Math.max(5, Math.ceil(Math.cbrt(count * 1.35))));
    const levels = Array.from({ length: steps }, (_, index) => Math.round(24 + 216 * index / (steps - 1)));
    for (const r of levels) for (const g of levels) for (const b of levels) {
      if (Math.max(r, g, b) - Math.min(r, g, b) >= 25) colors.add(hex([r, g, b]));
    }
  }
  return [...colors].map(color => ({ color, lab: oklab(color), used: false, global: Infinity }));
}

const categoryKey = ({ VALUE, CATEGORY }) => VALUE ?? CATEGORY;
const compareCategories = (a, b) => typeof a === 'number' && typeof b === 'number' ? a - b
  : typeof a !== typeof b ? (typeof a === 'number' ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0;

function nearbyCategories(features, neighbors) {
  const cells = new Map(), rad = Math.PI / 180, scale = 6_371_000 / 100;
  // Earth-centred buckets avoid longitude wraparound. Bound comparisons in densely populated cells.
  for (const { geometry: { coordinates: [lon, lat] }, properties } of features) {
    const cosLat = Math.cos(lat * rad);
    const position = [cosLat * Math.cos(lon * rad), cosLat * Math.sin(lon * rad), Math.sin(lat * rad)]
      .map(value => Math.floor(value * scale));
    const id = position.join('/');
    if (!cells.has(id)) cells.set(id, { position, values: new Set() });
    cells.get(id).values.add(categoryKey(properties));
  }
  for (const cell of cells.values()) cell.anchors = [...cell.values].sort(compareCategories).slice(0, 8);
  for (const { position: [x, y, z], values } of cells.values()) {
    const anchors = new Set();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const value of cells.get(`${x + dx}/${y + dy}/${z + dz}`)?.anchors || []) anchors.add(value);
    }
    for (const value of values) for (const other of anchors) {
      if (value === other || neighbors.get(value).has(other)) continue;
      neighbors.get(value).add(other);
      neighbors.get(other).add(value);
    }
  }
}

export function isIdentifierKpi(key) {
  return /(?:^|_)(?:PCI|EARFCN|ARFCN|ECI|NCI|cellIdentity)(?:_|$)/i.test(key);
}

export function colorMapCategories(features) {
  const values = [...new Set(features.map(({ properties }) => categoryKey(properties)))].sort(compareCategories);
  const neighbors = new Map(values.map(value => [value, new Set()]));
  if (values.length > 1) nearbyCategories(features, neighbors);
  const ordered = [...values].sort((a, b) => neighbors.get(b).size - neighbors.get(a).size || compareCategories(a, b));
  const colors = candidates(values.length), assigned = new Map();
  for (const value of ordered) {
    const nearby = [...neighbors.get(value)].filter(other => assigned.has(other)).map(other => assigned.get(other).lab);
    let best, bestScore = -Infinity;
    for (const candidate of colors) {
      if (candidate.used && assigned.size < colors.length) continue;
      let local = Infinity;
      for (const lab of nearby) local = Math.min(local, squaredDistance(candidate.lab, lab));
      const score = nearby.length ? local + .2 * candidate.global : candidate.global;
      if (!best || score > bestScore) { best = candidate; bestScore = score; }
    }
    best.used = true;
    assigned.set(value, best);
    for (const candidate of colors) candidate.global = Math.min(candidate.global, squaredDistance(candidate.lab, best.lab));
  }
  for (const { properties } of features) properties.COLOR = assigned.get(categoryKey(properties)).color;
  return values.map(value => ({ value, label: String(value), color: assigned.get(value).color }));
}

export function colorMapValues(features, [min, max]) {
  const low = rgb(gradient.low), high = rgb(gradient.high);
  const missing = features.some(({ properties }) => properties.VALUE === null);
  for (const { properties } of features) {
    const value = properties.VALUE;
    properties.COLOR = value === null ? gradient.missing : min === max ? gradient.single
      : hex(low.map((channel, index) => Math.round(channel + (value - min) / (max - min) * (high[index] - channel))));
  }
  const entries = min === max ? [{ value: min, label: format(min), color: gradient.single }]
    : [{ value: min, label: format(min), color: gradient.low }, { value: max, label: format(max), color: gradient.high }];
  if (missing) entries.push({ value: null, label: 'Non-numeric reading', color: gradient.missing });
  return entries;
}

export function mapPointLegend(key, map, items) {
  if (isPciKpi(key)) return { title: 'Legend', entries: map.categoryLegend };
  if (map.categoryLegend.length) return { title: `${metricName(key)} legend`, entries: map.categoryLegend };
  if (map.thresholdLegend.length) return { title: 'KPI thresholds', entries: map.thresholdLegend, showCounts: isSinrKpi(key) };
  if (map.valueLegend.length) return { title: 'KPI value', entries: map.valueLegend };
  return { title: key === technologyModeKey ? 'Technology mode legend' : 'UE legend',
    entries: map.samples.features.length ? items.map(({ tag, name, color }) => ({ value: tag, label: `${tag} ${name}`, color })) : [] };
}

const percent = new Intl.NumberFormat('en-AU', { style: 'percent', maximumFractionDigits: 1 }).format;
const share = fraction => fraction > 0 && fraction < .001 ? `<${percent(.001)}`
  : fraction > .999 && fraction < 1 ? `>${percent(.999)}` : percent(fraction);

export function mapLegendFilter(map, entries) {
  const { features } = map.samples;
  const key = map.categoryLegend.length ? categoryKey : map.thresholdLegend.length ? props => props.KPI_BAND
    : map.valueLegend.length ? props => props.VALUE : props => props.DEVICE;
  const counts = new Map();
  for (const { properties } of features) {
    const value = key(properties);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const valueOf = entry => map.thresholdLegend.length ? entry.label : entry.value;
  return {
    entries: entries.map(entry => {
      const count = counts.get(valueOf(entry)) || 0;
      return { ...entry, count, share: share(features.length ? count / features.length : 0) };
    }),
    samples: entry => entry ? { ...map.samples, features: features.filter(({ properties }) => key(properties) === valueOf(entry)) } : map.samples,
  };
}

export const mapLegendEntryLabel = (entry, showCounts = false) =>
  `${entry.label}${showCounts ? ` (${format(entry.count)})` : ''}`;

export function mapLegendExportEntry(entry, showCounts = false) {
  const names = (entry.cells || []).map(({ name, exact }) => exact ? name : `${name} (candidate)`);
  const share = showCounts ? ` ${entry.share}` : ` (${entry.share})`;
  return {
    label: `${mapLegendEntryLabel(entry, showCounts)}${share}${names.length ? ` — ${names.join(', ')}` : ''}`,
    color: entry.color,
    ...(showCounts ? { shape: 'circle' } : {}),
  };
}

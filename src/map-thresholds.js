const neutral = '#717888';
const belowThreshold = '#FF0000';
const profile = (cuts, upperInclusive, rows, unit) => ({
  cuts, upperInclusive, unit,
  bands: rows.map(([interval, label, color]) => ({ interval, label, color })),
});
const rsrpCoverage = profile([-115, -105, -95], [], [
  [3, 'Good: ≥ -95 dBm', '#0000FF'],
  [2, 'Moderate: -105 to < -95 dBm', '#00FF00'],
  [1, 'Basic: -115 to < -105 dBm', '#FFFF00'],
  [0, 'No coverage: < -115 dBm', belowThreshold],
], 'dBm');
const sinrBands = profile([-5, 0, 5, 10], [], [
  [0, 'Below -5.00', belowThreshold],
  [1, '≥ -5.00 to < 0.00', '#FFA600'],
  [2, '≥ 0.00 to < 5.00', '#FFFF00'],
  [3, '≥ 5.00 to < 10.00', '#00FF00'],
  [4, '≥ 10.00', '#008000'],
], 'dB');

// Other KPI bands follow the Macquarie Group reference, slides 16, 19 and 22.
const profiles = new Map([
  ['LTE_UE_RSRP', rsrpCoverage],
  ['NR_UE_RSRP_0', rsrpCoverage],
  ['Speech_MOS_POLQA_Score_DL', { ...profile([3, 4], [], [
    [2, '4 to 5 MOS', '#0000FF'],
    [1, '3 to < 4 MOS', '#93FF00'],
    [0, '< 3 MOS', belowThreshold],
  ], 'MOS'), max: 5 }],
  // Nemo supplies throughput in kbps; the reference bands are labeled in Mbps.
  ['App_Throughput_DL', profile([10_000, 20_000, 50_000], [1, 2], [
    [3, '> 50 Mbps', '#008000'],
    [2, '> 20 to 50 Mbps', '#00FF00'],
    [1, '10 to 20 Mbps', '#FFFF00'],
    [0, '< 10 Mbps', belowThreshold],
  ], 'kbps')],
  ['App_Throughput_UL', profile([2_000, 5_000, 10_000, 20_000], [1, 2, 3], [
    [4, '> 20 Mbps', '#0000FF'],
    [3, '> 10 to 20 Mbps', '#00FF00'],
    [2, '> 5 to 10 Mbps', '#FFFF00'],
    [1, '2 to 5 Mbps', '#FF8040'],
    [0, '< 2 Mbps', belowThreshold],
  ], 'kbps')],
]);

export const isSinrKpi = key => /(?:^|[^a-z0-9])SINR(?:[^a-z0-9]|$)/i.test(key);
export const thresholdProfile = key => isSinrKpi(key) ? sinrBands : profiles.get(key);
export const supportsMapThresholds = key => Boolean(thresholdProfile(key));

export function thresholdRange({ cuts, upperInclusive, unit, max }, interval) {
  const lower = interval ? `${upperInclusive.includes(interval - 1) ? '>' : '≥'} ${cuts[interval - 1]}` : '';
  const upper = interval < cuts.length ? `${upperInclusive.includes(interval) ? '≤' : '<'} ${cuts[interval]}`
    : max === undefined ? '' : `≤ ${max}`;
  return `${[lower, upper].filter(Boolean).join(' to ')} ${unit}`;
}

export function validateThresholds(key, { cuts, bands }) {
  const original = thresholdProfile(key);
  if (!original || cuts.length !== original.cuts.length ||
      cuts.some((n, i) => !Number.isFinite(n) || (i > 0 && n <= cuts[i - 1]))) {
    return 'Enter a number for each cutoff, in strictly increasing order.';
  }
  if (original.max !== undefined && cuts.at(-1) > original.max) {
    return `Cutoffs must not exceed ${original.max} ${original.unit}.`;
  }
  if (bands.length !== original.bands.length || bands.some(({ label, color }) => !label.trim() || !/^#[\da-f]{6}$/i.test(color))) {
    return 'Enter a label and a valid colour for every band.';
  }
  const labels = reportBands(original, { cuts, bands }).map(({ label }) => label.toLowerCase());
  if (original.max !== undefined && labels.includes('out-of-range reading')) {
    return 'Use a different label than “Out-of-range reading”.';
  }
  if (labels.includes('non-numeric reading') || new Set(labels).size !== labels.length) {
    return 'Use a different label for each band (other than “Non-numeric reading”).';
  }
  return '';
}

function reportBands(original, { cuts, bands }) {
  return original.bands.map(({ interval, label }, i) => {
    const range = thresholdRange({ ...original, cuts }, interval);
    return { interval, color: bands[i].color, label: bands[i].label.trim() === label && range !== thresholdRange(original, interval)
      ? range : bands[i].label.trim() };
  });
}

export function applyMapThresholds(key, features, { multipleDevices = false, override } = {}) {
  const original = thresholdProfile(key);
  if (!original || !features.length) return [];
  const device = features[0].properties.DEVICE;
  if ((!multipleDevices && !features.every(({ properties }) => properties.DEVICE === device)) ||
      !features.some(({ properties }) => Number.isFinite(properties.VALUE))) return [];

  if (override) {
    const error = validateThresholds(key, override);
    if (error) throw new Error(error);
  }
  const cuts = override?.cuts ?? original.cuts;
  const bands = override ? reportBands(original, override) : original.bands;
  const legend = bands.map(({ label, color }) => ({ label, color }));
  const unclassified = { label: 'Non-numeric reading', color: neutral };
  const outOfRange = { label: 'Out-of-range reading', color: neutral };
  for (const { properties } of features) {
    const value = properties.VALUE;
    const firstUpper = cuts.findIndex((cut, i) => value < cut || (value === cut && original.upperInclusive.includes(i)));
    const entry = !Number.isFinite(value) ? unclassified : original.max !== undefined && value > original.max ? outOfRange
      : bands.find(({ interval }) => interval === (firstUpper < 0 ? cuts.length : firstUpper));
    const { label, color } = entry;
    if ((entry === unclassified || entry === outOfRange) && !legend.includes(entry)) legend.push(entry);
    properties.KPI_BAND = label;
    properties.COLOR = color;
  }
  return legend;
}

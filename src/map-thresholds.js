const neutral = '#717888';
const belowThreshold = '#FF0000';
const band = (label, color, includes) => ({ label, color, includes });
const rsrpCoverage = [
  band('Good: ≥ -95 dBm', '#0000FF', value => value >= -95),
  band('Moderate: -105 to < -95 dBm', '#00FF00', value => value >= -105 && value < -95),
  band('Basic: -115 to < -105 dBm', '#FFFF00', value => value >= -115 && value < -105),
  band('No coverage: < -115 dBm', belowThreshold, value => value < -115),
];

// Other KPI bands follow the Macquarie Group reference, slides 16, 19 and 22.
const profiles = new Map([
  ['LTE_UE_RSRP', rsrpCoverage],
  ['NR_UE_RSRP_0', rsrpCoverage],
  ['LTE_UE_SINR', [
    band('> 10 dB', '#008000', value => value > 10),
    band('5 to 10 dB', '#00FF00', value => value >= 5 && value <= 10),
    band('< 5 dB', belowThreshold, value => value < 5),
  ]],
  ['NR_UE_SINR_0', [
    band('> 10 dB', '#00810D', value => value > 10),
    band('≤ 10 dB', belowThreshold, value => value <= 10),
  ]],
  ['Speech_MOS_POLQA_Score_DL', [
    band('4 to 5 MOS', '#0000FF', value => value >= 4 && value <= 5),
    band('3 to < 4 MOS', '#93FF00', value => value >= 3 && value < 4),
    band('< 3 MOS', belowThreshold, value => value < 3),
    band('> 5 MOS (outside reference range)', neutral, value => value > 5),
  ]],
  // Nemo supplies throughput in kbps; the reference bands are labeled in Mbps.
  ['App_Throughput_DL', [
    band('> 50 Mbps', '#008000', value => value > 50_000),
    band('> 20 to 50 Mbps', '#00FF00', value => value > 20_000 && value <= 50_000),
    band('10 to 20 Mbps', '#FFFF00', value => value >= 10_000 && value <= 20_000),
    band('< 10 Mbps', belowThreshold, value => value < 10_000),
  ]],
  ['App_Throughput_UL', [
    band('> 20 Mbps', '#0000FF', value => value > 20_000),
    band('> 10 to 20 Mbps', '#00FF00', value => value > 10_000 && value <= 20_000),
    band('> 5 to 10 Mbps', '#FFFF00', value => value > 5_000 && value <= 10_000),
    band('2 to 5 Mbps', '#FF8040', value => value >= 2_000 && value <= 5_000),
    band('< 2 Mbps', belowThreshold, value => value < 2_000),
  ]],
]);

export const supportsMapThresholds = key => profiles.has(key);

export function applyMapThresholds(key, features, { multipleDevices = false } = {}) {
  const bands = profiles.get(key);
  if (!bands || !features.length) return [];
  const device = features[0].properties.DEVICE;
  if ((!multipleDevices && !features.every(({ properties }) => properties.DEVICE === device)) ||
      !features.some(({ properties }) => Number.isFinite(properties.VALUE))) return [];

  const legend = bands.map(({ label, color }) => ({ label, color }));
  const unclassified = { label: 'Non-numeric reading', color: neutral };
  for (const { properties } of features) {
    const match = Number.isFinite(properties.VALUE) && bands.find(({ includes }) => includes(properties.VALUE));
    const { label, color } = match || unclassified;
    if (!match && legend.at(-1) !== unclassified) legend.push(unclassified);
    properties.KPI_BAND = label;
    properties.COLOR = color;
  }
  return legend;
}

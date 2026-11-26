import { isPciKpi, metricName, technologyModeKey } from './charts.js';

const lteKey = 'LTE_UE_EARFCN_DL';
const nrKey = 'NR_UE_NR_ARFCN_DL_0';

export function reportMetricName(key) {
  return key === lteKey ? 'LTE EARFCN' : key === nrKey ? 'NR-ARFCN' : metricName(key);
}

export function reportMapLegend(key, legend) {
  if (key === technologyModeKey) return { ...legend, title: 'Legend' };
  if (key === lteKey || key === nrKey) return {
    title: 'Channel number',
    entries: legend.entries.map(entry => entry.channelBands?.length
      ? { ...entry, label: `${entry.label} — ${entry.channelBands.map(band => `${band} MHz`).join(', ')}` }
      : entry),
  };
  if (isPciKpi(key)) return {
    title: 'Legend',
    entries: legend.entries.map(entry => {
      const names = (entry.cells || []).map(({ name, exact }) => exact ? name : `${name} (candidate)`);
      return names.length ? { ...entry, label: `${entry.label} — ${names.join(', ')}` } : entry;
    }),
  };
  return legend;
}

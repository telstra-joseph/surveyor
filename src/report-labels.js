import { metricName, technologyModeKey } from './charts.js';

const lteKey = 'LTE_UE_EARFCN_DL';
const nrKey = 'NR_UE_NR_ARFCN_DL_0';

// 3GPP TS 36.101 / 36.102: first and last downlink EARFCN, then the first frequency in MHz.
const lteRaster = [
  [0, 599, 2110], [600, 1199, 1930], [1200, 1949, 1805], [1950, 2399, 2110],
  [2400, 2649, 869], [2650, 2749, 875], [2750, 3449, 2620], [3450, 3799, 925],
  [3800, 4149, 1844.9], [4150, 4749, 2110], [4750, 4949, 1475.9],
  [5010, 5179, 729], [5180, 5279, 746], [5280, 5379, 758], [5730, 5849, 734],
  [5850, 5999, 860], [6000, 6149, 875], [6150, 6449, 791], [6450, 6599, 1495.9],
  [6600, 7399, 3510], [7500, 7699, 2180], [7700, 8039, 1525], [8040, 8689, 1930],
  [8690, 9039, 859], [9040, 9209, 852], [9210, 9659, 758], [9660, 9769, 717],
  [9770, 9869, 2350], [9870, 9919, 462.5], [9920, 10359, 1452],
  [36000, 36199, 1900], [36200, 36349, 2010], [36350, 36949, 1850], [36950, 37549, 1930],
  [37550, 37749, 1910], [37750, 38249, 2570], [38250, 38649, 1880], [38650, 39649, 2300],
  [39650, 41589, 2496], [41590, 43589, 3400], [43590, 45589, 3600], [45590, 46589, 703],
  [46590, 46789, 1447], [46790, 54539, 5150], [54540, 55239, 5855], [55240, 56739, 3550],
  [56740, 58239, 3550], [58240, 59089, 1432], [59090, 59139, 1427], [59140, 60139, 3300],
  [60140, 60254, 2483.5], [60255, 60304, 1670], [65536, 66435, 2110], [66436, 67335, 2110],
  [67336, 67535, 738], [67536, 67835, 753], [67836, 68335, 2570], [68336, 68585, 1995],
  [68586, 68935, 617], [68936, 68985, 461], [68986, 69035, 460], [69036, 69465, 1475],
  [69466, 70315, 1432], [70316, 70365, 1427], [70366, 70545, 728], [70546, 70595, 420],
  [70596, 70645, 422], [70646, 70655, 757], [70656, 70705, 935], [70656, 71055, 612],
  [71056, 73335, 470], [73386, 73485, 1820], [228301, 228500, 2180], [228501, 228570, 1518],
  [228571, 228735, 2483.5], [228736, 229075, 1525], [229076, 229375, 2170],
];

function channelFrequency(key, channel) {
  if (!Number.isSafeInteger(channel) || channel < 0) return undefined;
  if (key === lteKey) {
    const ranges = lteRaster.filter(([first, last]) => first <= channel && channel <= last);
    if (ranges.length !== 1) return undefined;
    const [[first, , mhz]] = ranges;
    return mhz + (channel - first) / 10;
  }
  // 3GPP TS 38.104: the global NR raster has three channel spacings.
  if (channel < 600000) return channel * .005;
  if (channel < 2016667) return 3000 + (channel - 600000) * .015;
  if (channel <= 3279165) return 24250.08 + (channel - 2016667) * .06;
}

const formatFrequency = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 3, useGrouping: false }).format;

export function reportMetricName(key) {
  return key === lteKey ? 'LTE EARFCN' : key === nrKey ? 'NR-ARFCN' : metricName(key);
}

export function reportMapLegend(key, legend) {
  if (key === technologyModeKey) return { ...legend, title: 'Legend' };
  if (key === lteKey || key === nrKey) return {
    title: 'Channel number',
    entries: legend.entries.map(entry => {
      const mhz = channelFrequency(key, entry.value);
      return { ...entry, label: `${entry.label} — ${mhz === undefined ? 'frequency unavailable' : `${formatFrequency(mhz)} MHz`}` };
    }),
  };
  if (key === 'LTE_UE_PCI' || key === 'NR_UE_PCI_0') return {
    ...legend,
    entries: legend.entries.map(entry => {
      const names = (entry.cells || []).map(({ name, exact }) => exact ? name : `${name} (candidate)`);
      return names.length ? { ...entry, label: `${entry.label} — ${names.join(', ')}` } : entry;
    }),
  };
  return legend;
}

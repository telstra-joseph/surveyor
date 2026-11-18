export const theme = {
  navy: '#1A2E61', blue: '#0D54FF', ink: '#131A35', muted: '#4B556B',
  grid: '#D4CDC3', paper: '#FFFFFF', cream: '#F5EDE2', coral: '#F96449',
  font: 'Telstra Text', display: 'Telstra Display Medium',
};

export const technologyModeKey = 'Technology_Mode';
const names = {
  LTE_UE_RSRP: 'LTE RSRP (dBm)', LTE_UE_SINR: 'LTE SINR (dB)',
  NR_UE_RSRP_0: '5G NR RSRP (dBm)', NR_UE_SINR_0: '5G NR SINR (dB)',
  Speech_MOS_POLQA_Score_DL: 'Downlink POLQA MOS',
  App_Throughput_DL: 'Downlink throughput (source units)',
  App_Throughput_UL: 'Uplink throughput (source units)',
  Voice_Event_CallAttempt: 'Call attempts', Voice_Call_EndResult: 'Call outcomes',
  Voice_Event_CallDrop: 'Call drops', Voice_Event_CallSetupFail: 'Call setup failures',
  [technologyModeKey]: 'Technology mode', LTE_Uu_RRC_ECI: 'LTE cell identity',
  LTE_UE_PCI: 'LTE PCI', LTE_UE_EARFCN_DL: 'LTE downlink EARFCN',
  NR_UE_PCI_0: '5G NR PCI', NR_UE_NR_ARFCN_DL_0: '5G NR downlink ARFCN',
  NR_RRC_CellAccessRelatedInfo_cellIdentity_0: '5G NR cell identity',
};
const colors = [theme.blue, theme.coral, '#007266', '#933576', theme.navy, '#955000', '#6540A7', '#496421'];
export const metricName = key => names[key] || key.replaceAll('_', ' ');
export const modes = { histogram: 'Distribution', series: 'Recorded samples', map: 'Map plot', statistics: 'Source statistics' };
export const format = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 4 }).format;
export const deviceName = survey => survey.profile || survey.filename.replace(/\.xlsx$/i, '');
const shorten = (value, limit) => value.length > limit ? `${value.slice(0, limit - 1)}…` : value;

export function datasets(surveys, key, mode) {
  return surveys.flatMap((survey, index) => {
    const metric = survey.metrics.find(metric => metric.key === key);
    const data = metric?.[mode];
    return (mode === 'map' ? metric?.geoCount : data?.length) ? [{
      tag: `S${index + 1}`, name: deviceName(survey), color: colors[index % colors.length],
      group: Math.floor(index / colors.length), index, data,
    }] : [];
  });
}

export function groupDatasets(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
  }
  return [...groups.values()];
}

// Use a stable label + occurrence key: distinct repeated bins must not overwrite one another.
export function sourceTable(items) {
  const rows = new Map();
  items.forEach(({ data }, column) => {
    const occurrences = new Map();
    for (const [label, value] of data) {
      const occurrence = (occurrences.get(label) || 0) + 1;
      occurrences.set(label, occurrence);
      const key = JSON.stringify([label, occurrence]);
      if (!rows.has(key)) rows.set(key, { label, values: Array(items.length).fill(null) });
      rows.get(key).values[column] = value;
    }
  });
  return [...rows.values()];
}

export const binsPerPage = 7;
export const markLimit = 240;
export function samplePoints(data) {
  if (data.length <= markLimit) return data;
  // Keep the low and high readings in each consecutive bucket, plus both endpoints.
  const result = [data[0]];
  const buckets = (markLimit - 2) / 2;
  for (let i = 0; i < buckets; i++) {
    const start = 1 + Math.floor(i * (data.length - 2) / buckets);
    const end = 1 + Math.floor((i + 1) * (data.length - 2) / buckets);
    let low = start;
    let high = start;
    for (let j = start + 1; j < end; j++) {
      if (data[j][1] < data[low][1]) low = j;
      if (data[j][1] > data[high][1]) high = j;
    }
    for (const j of [...new Set([low, high])].sort((a, b) => a - b)) result.push(data[j]);
  }
  return [...result, data.at(-1)];
}

export function chart(title, mode, items, page = 0) {
  const width = 900, height = 385;
  const left = 95, right = 878, top = 31, bottom = 300;
  const marks = [];
  const text = (value, x, y, size = 14, align = 'left', color = theme.muted) =>
    marks.push({ kind: 'text', value, x, y, size, align, color });
  const rect = (x, y, w, h, color) => marks.push({ kind: 'rect', x, y, w, h, color });
  let min = Infinity, max = -Infinity, last = 1;
  const rows = mode === 'histogram' ? sourceTable(items) : [];
  const visible = rows.slice(page * binsPerPage, (page + 1) * binsPerPage);
  if (mode === 'histogram') {
    min = 0;
    max = 1;
    for (const { values } of rows) for (const count of values) max = Math.max(max, count ?? 0);
    const step = 10 ** Math.floor(Math.log10(max));
    max = Math.ceil(max / step) * step;
  } else {
    for (const { data } of items) {
      last = Math.max(last, data.at(-1)[0]);
      for (const [, value] of data) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    if (min === max) { min -= 1; max += 1; }
  }
  const yAt = value => bottom - (value - min) / (max - min) * (bottom - top);
  for (let i = 0; i <= 4; i++) {
    const value = min + i * (max - min) / 4;
    rect(left, yAt(value), right - left, 1, theme.grid);
    text(shorten(format(value), 11), left - 11, yAt(value), 13, 'right');
  }
  if (mode === 'histogram') {
    const group = (right - left) / visible.length;
    const bar = Math.min(42, group * .82 / items.length);
    visible.forEach(({ label, values }, i) => {
      const mid = left + group * (i + .5);
      text(shorten(label, 17), mid, bottom + 32, 13, 'center');
      values.forEach((value, j) => {
        const x = mid + bar * (j - (items.length - 1) / 2);
        if (value !== null) {
          const h = Math.max(2, bottom - yAt(value));
          rect(x - bar * .43, bottom - h, bar * .86, h, items[j].color);
        }
        if (bar >= 14) text(items[j].tag, x, bottom + 12, 9, 'center');
      });
    });
    text('Workbook ranges or categories', (left + right) / 2, 365, 15, 'center', theme.ink);
    text(shorten(`${title} — workbook counts`, 95), left, 13, 14, 'left', theme.ink);
  } else {
    const xAt = row => left + (row - 1) / Math.max(1, last - 1) * (right - left);
    for (const { data, color } of items) {
      for (const [row, value] of samplePoints(data)) {
        marks.push({ kind: 'dot', x: xAt(row) - 2, y: yAt(value) - 2, w: 4, h: 4, color });
      }
    }
    for (let i = 0; i <= Math.min(4, last - 1); i++) {
      const row = 1 + Math.round((last - 1) * i / Math.min(4, Math.max(1, last - 1)));
      text(format(row), xAt(row), bottom + 21, 13, 'center');
    }
    text('Row position within each workbook (not time-aligned)', (left + right) / 2, 365, 15, 'center', theme.ink);
    text(shorten(title, 95), left, 13, 14, 'left', theme.ink);
  }
  return { title: `${title} — ${modes[mode]}`, width, height, marks };
}

export function legend(title, items) {
  return legendImage(title, items.map(({ color, tag, name }) => ({
    color, label: `${tag}  ${shorten(name, items.length > 4 ? 43 : 93)}`,
  })));
}

export function legendImage(title, items) {
  const columns = items.length > 4 ? 2 : 1;
  const marks = [];
  items.forEach(({ color, label }, index) => {
    const x = 14 + (index % columns) * (900 / columns);
    const y = 16 + Math.floor(index / columns) * 29;
    marks.push({ kind: 'rect', x, y: y - 6, w: 12, h: 12, color });
    marks.push({ kind: 'text', value: shorten(label, columns === 1 ? 100 : 48), x: x + 23, y, size: 15, align: 'left', color: theme.ink });
  });
  return { title: `${title} — legend`, width: 900, height: Math.ceil(items.length / columns) * 29 + 4, marks };
}

export const escapeMarkup = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[char]);

export function toSvg({ title, width, height, marks }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeMarkup(title)}">
  <title>${escapeMarkup(title)}</title><rect class="plot-paper" width="100%" height="100%" fill="${theme.paper}"/>
  ${marks.map(({ kind, value, x, y, w, h, size, align, color }) => {
    if (kind === 'text') {
      const anchor = { left: 'start', right: 'end', center: 'middle' }[align];
      return `<text x="${x}" y="${y}" fill="${color}" font-family="${theme.font}, Arial, sans-serif" font-size="${size}" text-anchor="${anchor}" dominant-baseline="central">${escapeMarkup(value)}</text>`;
    }
    if (kind === 'dot') return `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${w / 2}" fill="${color}"/>`;
    return `<rect${color === theme.grid ? ' class="plot-grid"' : ''} x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>`;
  }).join('')}</svg>`;
}

import ExcelJS from 'exceljs';
import { technologyModeKey } from './charts.js';
import { radioFields, surveyDay, validCoordinates } from './geo.js';
import { addNetworkEvidence, networkColumns, networkFromLabel } from './network.js';

const SHEETS = {
  series: 'Series Formatted Data',
  histogram: 'Histogram Formatted Data',
  statistics: 'Statistic Formatted Data',
};
const metadata = new Set(['Message', 'Time', 'Distance', 'Longitude', 'Latitude', 'Nemo_Header_DeviceLabel', 'index']);
const columnName = value => value.toLowerCase() === 'technology_mode' ? technologyModeKey : value;

function scalar(value) {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('result' in value) return scalar(value.result);
    if (Array.isArray(value.richText)) return value.richText.map(({ text }) => text).join('');
    if (typeof value.text === 'string') return value.text;
    return null;
  }
  return value;
}

function label(value) {
  const raw = scalar(value);
  return typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
}

function number(value) {
  const raw = scalar(value);
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export async function parseWorkbook(buffer, filename) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  const worksheets = new Map(book.worksheets.map(sheet => [sheet.name.trim().toLowerCase(), sheet]));
  const metrics = new Map();
  const warnings = [];
  const metric = key => {
    if (!metrics.has(key)) metrics.set(key, { key, series: [], histogram: [], statistics: [] });
    return metrics.get(key);
  };
  let profile = '';
  let rows = 0;
  const geography = {};
  const days = new Set();
  const networkEvidence = new Set();
  if (networkFromLabel(filename) === 'other') networkEvidence.add('other');
  for (const [kind, name] of Object.entries(SHEETS)) {
    const sheet = worksheets.get(name.toLowerCase());
    if (!sheet) {
      warnings.push(`${name} is missing.`);
      continue;
    }
    let columns;
    let headerRow;
    let profileColumn;
    let columnsByName;
    let servingNetworkColumns;
    let invalidCounts = 0;
    sheet.eachRow((row, rowNumber) => {
      if (!columns) {
        const headers = new Map();
        row.eachCell((cell, col) => headers.set(col, columnName(label(cell.value))));
        const entries = [...headers];
        if (kind === 'series') {
          if (!entries.some(([, key]) => key === 'Time' || key === 'Distance') &&
              !['Longitude', 'Latitude'].every(name => entries.some(([, key]) => key === name))) return;
          profileColumn = entries.find(([, key]) => key === 'Nemo_Header_DeviceLabel')?.[0];
          columnsByName = new Map(entries.map(([col, key]) => [key, col]));
          servingNetworkColumns = networkColumns(entries);
          columns = entries.filter(([, key]) => key && !metadata.has(key));
        } else {
          const prefix = kind === 'histogram' ? /^range(?:\.\d+)?$/i : /^statistic(?:\.\d+)?$/i;
          columns = entries.filter(([col, text]) => prefix.test(text) && headers.get(col + 1))
            .map(([col]) => [col, headers.get(col + 1)]);
        }
        if (!columns.length) columns = undefined;
        else headerRow = rowNumber;
        return;
      }
      if (kind === 'series') {
        rows++;
        const position = rowNumber - headerRow;
        const read = key => columnsByName.has(key) ? row.getCell(columnsByName.get(key)).value : null;
        const day = surveyDay(scalar(read('Time')), book.properties.date1904);
        if (day) days.add(day);
        const lon = number(read('Longitude')), lat = number(read('Latitude'));
        const located = validCoordinates(lon, lat);
        // Keep every row: indoor floor plans can position rows without GPS, or in plan units outside lon/lat ranges.
        const planar = !located && lon !== null && lat !== null && (lon !== 0 || lat !== 0);
        geography[position] = { coords: located ? [lon, lat] : null, ...(planar ? { xy: [lon, lat] } : {}), day,
          radio: Object.fromEntries(Object.entries(radioFields).map(([rat, keys]) => [rat, keys.map(key => number(read(key)))])) };
        if (profileColumn) {
          const device = label(row.getCell(profileColumn).value);
          if (!profile) profile = device;
          if (device) networkEvidence.add(networkFromLabel(device));
        }
        addNetworkEvidence(networkEvidence, servingNetworkColumns, col => label(row.getCell(col).value));
        for (const [col, key] of columns) {
          const raw = row.getCell(col).value;
          const value = number(raw);
          const category = label(raw);
          if (value !== null) metric(key).series.push([position, value]);
          if (category && (value === null || key === technologyModeKey)) (metric(key).geoCategories ??= []).push([position, category]);
          if (located && (value !== null || category)) {
            const item = metric(key);
            item.geoCount = (item.geoCount || 0) + 1;
          }
        }
      } else {
        for (const [col, key] of columns) {
          const name = label(row.getCell(col).value);
          if (!name) continue;
          const raw = row.getCell(col + 1).value;
          const value = number(raw);
          if (kind === 'histogram') {
            if (value !== null && Number.isSafeInteger(value) && value >= 0) metric(key).histogram.push([name, value]);
            else invalidCounts++;
          } else {
            const stat = value ?? label(raw);
            if (stat !== '') metric(key).statistics.push([name, stat]);
          }
        }
      }
    });
    if (!columns) warnings.push(`${name} does not have a recognized header.`);
    if (invalidCounts) warnings.push(`${name}: ${invalidCounts} blank or invalid counts omitted.`);
  }
  if (!metrics.size) throw new Error('No usable KPI data found in the formatted survey sheets.');
  if (days.size === 1) {
    const [day] = days;
    for (const location of Object.values(geography)) if (!location.day) location.day = day;
  }
  return {
    filename, profile, rows, warnings, geography, days: [...days].sort(), metrics: [...metrics.values()],
    network: networkEvidence.has('other') ? 'other' : networkEvidence.has('telstra') ? 'telstra' : 'unknown',
  };
}

import Papa from 'papaparse';
import { technologyModeKey } from './charts.js';
import { applyMapThresholds } from './map-thresholds.js';
import { carrierCode, sectorKey } from './sector-style.js';

const dayMs = 86_400_000;
const technologyColors = new Map([
  ['LTE', '#0D54FF'], ['LTE-5GNR', '#007266'], ['5GSA', '#A94318'],
]);
const otherModeColors = ['#933576', '#496421', '#6540A7', '#955000', '#35486D'];
export const radioFields = {
  LTE: ['LTE_Uu_RRC_ECI', 'LTE_UE_PCI', 'LTE_UE_EARFCN_DL'],
  NR: ['NR_RRC_CellAccessRelatedInfo_cellIdentity_0', 'NR_UE_PCI_0', 'NR_UE_NR_ARFCN_DL_0'],
};

export function validCoordinates(lon, lat) {
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90 && (lon !== 0 || lat !== 0);
}

export function isoDay(text) {
  const day = /^(\d{4}-\d{2}-\d{2})(?=$|T|[ _])/.exec(String(text))?.[1];
  const timestamp = Date.parse(day);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === day ? day : '';
}

export function surveyDay(value, date1904) {
  if (typeof value === 'string') return isoDay(value.trim());
  if (value instanceof Date && Number.isFinite(+value)) return isoDay(value.toISOString());
  if (typeof value === 'number' && value >= 1 && value <= 2_958_000) {
    return isoDay(new Date(Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) + Math.floor(value) * dayMs).toISOString());
  }
  return '';
}

const identifier = value => {
  const text = String(value ?? '').trim();
  const n = /^(?:\d+(?:\.0+)?|0x[\da-f]+)$/i.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

function sectorAngles(row) {
  const azimuth = row.AZIMUTH?.trim() ? Number(row.AZIMUTH) : NaN;
  const beamwidth = row.BEAMWIDTH?.trim() ? Number(row.BEAMWIDTH) : NaN;
  if (!(beamwidth > 0 && beamwidth <= 360)) return null;
  if (beamwidth === 360) return { azimuth: 0, beamwidth };
  return azimuth >= 0 && azimuth <= 360 ? { azimuth: azimuth % 360, beamwidth } : null;
}

export function parseActix(text, filename, override) {
  const day = isoDay(override || filename.match(/\d{4}-\d{2}-\d{2}(?=[ _T.]|$)/)?.[0]);
  if (!day) throw new Error('No valid snapshot date in filename. Enter its date before importing.');
  const { data, errors, meta } = Papa.parse(text, { header: true, skipEmptyLines: 'greedy', transformHeader: field => field.trim().toUpperCase() });
  if (errors.length) throw new Error(`CSV could not be read: ${errors[0].message}`);
  const columns = new Set(meta.fields);
  const rat = columns.has('NCI') ? 'NR' : columns.has('ECI') ? 'LTE' : '';
  if (!rat) throw new Error('Expected an Actix cell file with an ECI or NCI column.');
  const [id, pci, channel] = rat === 'LTE' ? ['ECI', 'PCI', 'DL_EARFCN'] : ['NCI', 'NR_PCI', 'DL_NR_ARFCN'];
  if (![pci, channel, 'LATITUDE', 'LONGITUDE', 'SITEID'].every(key => columns.has(key))) {
    throw new Error('Required Actix site, coordinate, PCI or downlink channel columns are missing.');
  }
  const cells = data.flatMap(row => {
    const identity = identifier(row[id]);
    const physical = identifier(row[pci]);
    const frequency = identifier(row[channel]);
    if (!identity && (physical === null || frequency === null)) return [];
    const lon = row.LONGITUDE?.trim() ? Number(row.LONGITUDE) : NaN;
    const lat = row.LATITUDE?.trim() ? Number(row.LATITUDE) : NaN;
    const site = row.SITEID?.trim() || '', sector = row.SECTOR_ID?.trim() || '', name = row.CELL_NAME?.trim() || sector;
    return [{
      id: identity || null, pci: physical, channel: frequency, site, sector, name, carrier: carrierCode(site, name, sector),
      coords: validCoordinates(lon, lat) ? [lon, lat] : null,
      angles: sectorAngles(row),
    }];
  });
  if (!cells.length) throw new Error('No usable Actix cell identifiers.');
  return { rat, day, filename, cells, skipped: data.length - cells.length };
}

export function closestSnapshot(snapshots, rat, day, maxDays) {
  if (!day) return null;
  const date = Date.parse(day);
  let best = null;
  for (const snapshot of snapshots) {
    if (snapshot.rat !== rat) continue;
    const days = (Date.parse(snapshot.day) - date) / dayMs;
    if (Math.abs(days) > maxDays) continue;
    if (!best || Math.abs(days) < Math.abs(best.days) || (Math.abs(days) === Math.abs(best.days) && days < best.days)) {
      best = { snapshot, days };
    }
  }
  return best;
}

function indexCells(cells) {
  const ids = new Map(), pairs = new Map(), bySite = new Map();
  function add(map, key, cell) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(cell);
  }
  for (const cell of cells) {
    if (cell.id) add(ids, cell.id, cell);
    if (cell.pci !== null && cell.channel !== null) add(pairs, `${cell.pci}/${cell.channel}`, cell);
    if (cell.site && cell.coords && cell.angles) add(bySite, cell.site, cell);
  }
  return { ids, pairs, bySite };
}

const distance = ([a, b], [c, d]) => {
  const rad = Math.PI / 180;
  const h = Math.sin((b - d) * rad / 2) ** 2 + Math.cos(b * rad) * Math.cos(d * rad) * Math.sin((a - c) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
};

function matchCell({ ids, pairs }, [id, pci, channel], coords) {
  const usingId = Number.isSafeInteger(id) && id > 0;
  const candidates = usingId ? ids.get(id) : Number.isSafeInteger(pci) && Number.isSafeInteger(channel) && pairs.get(`${pci}/${channel}`);
  if (!candidates?.length) return { match: 'Unmatched' };
  let cell = candidates[0], km = Infinity;
  for (const candidate of candidates) {
    if (!candidate.coords) continue;
    const gap = distance(coords, candidate.coords);
    if (gap < km) { cell = candidate; km = gap; }
  }
  return { match: usingId ? (candidates.length === 1 ? 'Exact ID' : 'Duplicate ID') : 'PCI/channel candidate',
    ...cell, count: candidates.length,
    km: Number.isFinite(km) ? Math.round(km * 1000) / 1000 : null };
}

export function mapFeatures({ workbooks, snapshots, key, maxDays, legendMode = 'auto' }) {
  const indexes = new Map(), dates = new Map(), sites = new Map();
  const sectors = new Map(), sectorGroups = new Map();
  const features = [];
  const isTechnologyMode = key === technologyModeKey;
  let min = Infinity, max = -Infinity;
  for (const { survey, tag, color } of workbooks) {
    const metric = survey.metrics.find(item => item.key === key);
    const categories = metric.geoCategories || [];
    for (const points of isTechnologyMode ? [categories] : [metric.series, categories]) for (const [row, value] of points) {
      const location = survey.geography[row];
      if (!location) continue;
      const { coords, day, radio } = location;
      if (typeof value === 'number') { min = Math.min(min, value); max = Math.max(max, value); }
      const props = { KIND: 'KPI sample', KPI: key, VALUE: typeof value === 'number' ? value : null,
        CATEGORY: typeof value === 'string' ? value : '', WORKBOOK: survey.filename, DEVICE: tag, LOG_ROW: row, SURVEYDAY: day,
        COLOR: color, NETWORK: survey.network === 'telstra' ? 'Telstra' : survey.network === 'other' ? 'Non-Telstra evidence' : 'Telstra (assumed)' };
      const sample = { type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: props };
      for (const [rat, prefix] of [['LTE', 'L'], ['NR', 'N']]) {
        const values = radio[rat];
        if (!values?.some(value => value !== null)) continue;
        if (survey.network === 'other') {
          props[`${prefix}_MATCH`] = 'Skipped: non-Telstra evidence';
          continue;
        }
        const lookup = `${rat}/${day}`;
        if (!dates.has(lookup)) dates.set(lookup, closestSnapshot(snapshots, rat, day, maxDays));
        const chosen = dates.get(lookup);
        if (!chosen) {
          props[`${prefix}_MATCH`] = day ? 'No nearby snapshot' : 'Survey date unknown';
          continue;
        }
        const { snapshot, days } = chosen;
        if (!indexes.has(snapshot)) indexes.set(snapshot, indexCells(snapshot.cells));
        const index = indexes.get(snapshot);
        const match = matchCell(index, values, coords);
        Object.assign(props, {
          [`${prefix}_MATCH`]: match.match, [`${prefix}_DATE`]: snapshot.day, [`${prefix}_DAYS`]: days,
          [`${prefix}_CELL`]: match.id == null ? '' : String(match.id), [`${prefix}_SITE`]: match.site || '',
          [`${prefix}_NAME`]: match.name || '',
          [`${prefix}_SECT`]: match.sector || '', [`${prefix}_COUNT`]: match.count ?? null, [`${prefix}_KM`]: match.km ?? null,
        });
        if (match.coords) {
          const siteKey = JSON.stringify([rat, snapshot.day, match.id, match.site, match.sector, match.coords, match.angles, match.carrier]);
          const previous = sites.get(siteKey);
          const siteId = previous?.id ?? sites.size;
          if (!previous || match.match === 'Exact ID') sites.set(siteKey, {
            type: 'Feature', id: siteId, geometry: { type: 'Point', coordinates: match.coords }, angles: match.angles, carrier: match.carrier,
            properties: { KIND: 'Actix cell', RAT: rat, SNAPSHOT: snapshot.day, CELL_ID: String(match.id ?? ''),
              SITE_ID: match.site, SECTOR: match.sector, MATCH: match.match },
          });
          (sample.siteLinks ||= []).push({ siteId, exact: match.match === 'Exact ID' });
          if (!previous) {
            if (!sectorGroups.has(snapshot)) sectorGroups.set(snapshot, new Set());
            const groups = sectorGroups.get(snapshot);
            if (!match.site || !groups.has(match.site)) {
              if (match.site) groups.add(match.site);
              for (const { coords, angles, carrier } of index.bySite.get(match.site) || [match]) {
                if (!angles) continue;
                const sector = { rat, coords, ...angles, carrier };
                sectors.set(sectorKey(sector), sector);
              }
            }
          }
        }
      }
      features.push(sample);
    }
  }
  const technologyLegend = [];
  if (isTechnologyMode) {
    const modes = [...new Set(features.map(({ properties }) => properties.CATEGORY))].sort();
    let fallback = 0;
    for (const label of modes) {
      const color = technologyColors.get(label.toUpperCase()) || otherModeColors[fallback++ % otherModeColors.length];
      technologyLegend.push({ label, color });
    }
    const colors = new Map(technologyLegend.map(({ label, color }) => [label, color]));
    for (const { properties } of features) properties.COLOR = colors.get(properties.CATEGORY);
  }
  return { samples: { type: 'FeatureCollection', features }, sites: { type: 'FeatureCollection', features: [...sites.values()] },
    extent: Number.isFinite(min) ? [min, max] : null, technologyLegend,
    thresholdLegend: legendMode === 'ue' ? [] : applyMapThresholds(key, features, { multipleDevices: legendMode === 'thresholds' }),
    ueColors: legendMode === 'ue', sectors: [...sectors.values()] };
}

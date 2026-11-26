import Papa from 'papaparse';
import { callDropKey, dropLegendEntry, isDropDetected, technologyModeKey } from './charts.js';
import { colorMapCategories, colorMapValues, isIdentifierKpi } from './map-colors.js';
import { applyMapThresholds, supportsMapThresholds } from './map-thresholds.js';
import { carrierBand, carrierCode, sectorKey } from './sector-style.js';

const dayMs = 86_400_000;
export const radioFields = {
  LTE: ['LTE_Uu_RRC_ECI', 'LTE_UE_PCI', 'LTE_UE_EARFCN_DL'],
  NR: ['NR_RRC_CellAccessRelatedInfo_cellIdentity_0', 'NR_UE_PCI_0', 'NR_UE_NR_ARFCN_DL_0'],
};

const radioKeys = new Set(Object.values(radioFields).flat());

export function mapWorkbook(survey, key, tag, color) {
  const { filename, geography, metrics, network } = survey;
  return { tag, color, survey: { filename, geography, network,
    metrics: metrics.filter(metric => metric.key === key || radioKeys.has(metric.key))
      .map(({ key, series, geoCategories }) => ({ key, series, geoCategories })),
  } };
}

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

export const snapshotDateRequired = 'No valid snapshot date in filename. Enter a date override and select the file again.';

export function parseActix(text, filename, override) {
  const day = isoDay(override || filename.match(/\d{4}-\d{2}-\d{2}(?=[ _T.]|$)/)?.[0]);
  if (!day) throw new Error(snapshotDateRequired);
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

function indexCells({ cells, rat }, includeChannelBands) {
  const ids = new Map(), pairs = new Map(), bySite = new Map();
  const bandsByChannel = new Map();
  function add(map, key, cell) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(cell);
  }
  for (const cell of cells) {
    if (cell.id) add(ids, cell.id, cell);
    if (cell.pci !== null && cell.channel !== null) add(pairs, `${cell.pci}/${cell.channel}`, cell);
    if (cell.site && cell.coords && cell.angles) add(bySite, cell.site, cell);
    if (includeChannelBands && Number.isSafeInteger(cell.channel)) {
      const band = carrierBand(rat, cell.carrier);
      if (band) {
        if (!bandsByChannel.has(cell.channel)) bandsByChannel.set(cell.channel, new Set());
        bandsByChannel.get(cell.channel).add(band);
      }
    }
  }
  return { ids, pairs, bySite, bandsByChannel };
}

const distance = ([a, b], [c, d]) => {
  const rad = Math.PI / 180;
  const h = Math.sin((b - d) * rad / 2) ** 2 + Math.cos(b * rad) * Math.cos(d * rad) * Math.sin((a - c) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
};

function servingIdentities(survey, rat) {
  const [identity, physical, frequency] = radioFields[rat].map(key => survey.metrics.find(metric => metric.key === key)?.series);
  const carried = new Map();
  if (!identity?.length || !physical?.length) return carried;
  // Replay the raw radio readings, including handovers and changes on rows without GPS.
  const readings = new Map();
  for (const [column, series] of [identity, physical, frequency].entries()) {
    for (const [row, value] of series || []) {
      if (!Number.isSafeInteger(value) || value < 0 || (column === 0 && value === 0)) continue;
      if (!readings.has(row)) readings.set(row, []);
      readings.get(row)[column] = value;
    }
  }
  let serving;
  for (const row of [...readings.keys()].sort((a, b) => a - b)) {
    const [id, pci, channel] = readings.get(row);
    if (id !== undefined) {
      serving = { id, pci, channel };
    } else if (serving) {
      if ((pci !== undefined && serving.pci !== undefined && pci !== serving.pci) ||
          (channel !== undefined && serving.channel !== undefined && channel !== serving.channel)) {
        serving = undefined;
        continue;
      }
      serving.pci ??= pci;
      serving.channel ??= channel;
      if (pci !== undefined && survey.geography[row]) carried.set(row, serving.id);
    }
  }
  return carried;
}

function matchCell({ ids, pairs }, [id, pci, channel], coords) {
  const usingId = Number.isSafeInteger(id) && id > 0;
  const candidates = usingId ? ids.get(id) : Number.isSafeInteger(pci) && Number.isSafeInteger(channel) && pairs.get(`${pci}/${channel}`);
  if (!candidates?.length) return { match: 'Unmatched' };
  let cell = candidates[0], km = Infinity;
  let tied = false, missingCoordinates = false;
  for (const candidate of candidates) {
    if (!candidate.coords) {
      missingCoordinates = true;
      continue;
    }
    const gap = distance(coords, candidate.coords);
    if (gap < km) { cell = candidate; km = gap; tied = false; }
    else if (gap === km) tied = true;
  }
  return { match: usingId ? (candidates.length === 1 ? 'Exact ID' : 'Duplicate ID') : 'PCI/channel candidate',
    ...cell, count: candidates.length,
    unambiguous: candidates.length === 1 || (!usingId && !tied && !missingCoordinates),
    km: Number.isFinite(km) ? Math.round(km * 1000) / 1000 : null };
}

export function mapFeatures({ workbooks, snapshots, key, maxDays, legendMode = 'auto', thresholdOverride }) {
  const indexes = new Map(), dates = new Map(), sites = new Map();
  const sectors = new Map(), sectorGroups = new Map();
  const features = [];
  const pciRat = Object.keys(radioFields).find(rat => radioFields[rat][1] === key);
  const channelRat = Object.keys(radioFields).find(rat => radioFields[rat][2] === key);
  const channelBands = new Map();
  const pciNames = new Map();
  const pciCounts = new Map();
  const isTechnologyMode = key === technologyModeKey;
  const isCallDrop = key === callDropKey;
  let min = Infinity, max = -Infinity;
  for (const { survey, tag, color } of workbooks) {
    const metric = survey.metrics.find(item => item.key === key);
    const categories = metric.geoCategories || [];
    const identities = {};
    if (survey.network !== 'other') {
      for (const rat of Object.keys(radioFields)) {
        if (snapshots.some(snapshot => snapshot.rat === rat)) identities[rat] = servingIdentities(survey, rat);
      }
    }
    for (const points of isTechnologyMode ? [categories] : [metric.series, categories]) for (const [row, value] of points) {
      if (isCallDrop && !isDropDetected(value)) continue;
      const location = survey.geography[row];
      if (!location?.coords) continue;
      const { coords, day, radio } = location;
      if (typeof value === 'number') { min = Math.min(min, value); max = Math.max(max, value); }
      const props = { KIND: 'KPI sample', KPI: key, VALUE: typeof value === 'number' ? value : null,
        CATEGORY: typeof value === 'string' ? value : '', WORKBOOK: survey.filename, DEVICE: tag, LOG_ROW: row, SURVEYDAY: day,
        COLOR: isCallDrop ? dropLegendEntry.color : color,
        NETWORK: survey.network === 'telstra' ? 'Telstra' : survey.network === 'other' ? 'Non-Telstra evidence' : 'Telstra (assumed)' };
      const sample = { type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: props };
      for (const [rat, prefix] of [['LTE', 'L'], ['NR', 'N']]) {
        const values = radio[rat] || [];
        const hasRadio = values.some(value => value !== null);
        if (!hasRadio && rat !== channelRat) continue;
        if (survey.network === 'other') {
          if (hasRadio) props[`${prefix}_MATCH`] = 'Skipped: non-Telstra evidence';
          continue;
        }
        const lookup = `${rat}/${day}`;
        if (!dates.has(lookup)) dates.set(lookup, closestSnapshot(snapshots, rat, day, maxDays));
        const chosen = dates.get(lookup);
        if (!chosen) {
          if (hasRadio) props[`${prefix}_MATCH`] = day ? 'No nearby snapshot' : 'Survey date unknown';
          continue;
        }
        const { snapshot, days } = chosen;
        if (!indexes.has(snapshot)) indexes.set(snapshot, indexCells(snapshot, rat === channelRat));
        const index = indexes.get(snapshot);
        const carriedId = identities[rat]?.get(row);
        const match = matchCell(index, carriedId === undefined ? values : [carriedId, values[1], values[2]], coords);
        if (rat === channelRat) {
          const candidates = index.bandsByChannel.get(value);
          const matchedBand = match.unambiguous && match.channel === value && carrierBand(rat, match.carrier);
          const band = matchedBand || (candidates?.size === 1 ? candidates.values().next().value : undefined);
          if (band) {
            if (!channelBands.has(value)) channelBands.set(value, new Set());
            channelBands.get(value).add(band);
          }
        }
        if (!hasRadio) continue;
        if (rat === pciRat && typeof value === 'number' && match.name && match.unambiguous &&
            (match.pci === null || match.pci === value)) {
          if (!pciNames.has(value)) pciNames.set(value, new Map());
          const names = pciNames.get(value);
          names.set(match.name, names.get(match.name) || match.match === 'Exact ID');
        }
        Object.assign(props, {
          [`${prefix}_MATCH`]: match.match, [`${prefix}_DATE`]: snapshot.day, [`${prefix}_DAYS`]: days,
          [`${prefix}_CELL`]: match.id == null ? '' : String(match.id), [`${prefix}_SITE`]: match.site || '',
          [`${prefix}_NAME`]: match.name || '',
          [`${prefix}_SECT`]: match.sector || '', [`${prefix}_COUNT`]: match.count ?? null, [`${prefix}_KM`]: match.km ?? null,
        });
        if (match.coords) {
          const siteKey = JSON.stringify([rat, snapshot.day, match.id, match.site, match.sector, match.coords, match.angles,
            match.carrier, rat === pciRat ? match.pci : undefined]);
          const previous = sites.get(siteKey);
          const siteId = previous?.id ?? sites.size;
          if (!previous || match.match === 'Exact ID') sites.set(siteKey, {
            type: 'Feature', id: siteId, geometry: { type: 'Point', coordinates: match.coords }, angles: match.angles, carrier: match.carrier,
            pci: rat === pciRat ? match.pci : undefined,
            properties: { KIND: 'Actix cell', RAT: rat, SNAPSHOT: snapshot.day, CELL_ID: String(match.id ?? ''),
              SITE_ID: match.site, SECTOR: match.sector, MATCH: match.match },
          });
          (sample.siteLinks ||= []).push({ siteId, exact: match.match === 'Exact ID' });
          if (!previous) {
            if (!sectorGroups.has(snapshot)) sectorGroups.set(snapshot, new Set());
            const groups = sectorGroups.get(snapshot);
            if (!match.site || !groups.has(match.site)) {
              if (match.site) groups.add(match.site);
              for (const { coords, angles, carrier, pci } of index.bySite.get(match.site) || [match]) {
                if (!angles) continue;
                const sector = { rat, coords, ...angles, carrier, ...(rat === pciRat ? { pci } : {}) };
                sectors.set(sectorKey(sector), sector);
              }
            }
          }
        }
      }
      features.push(sample);
      if (pciRat) pciCounts.set(value, (pciCounts.get(value) || 0) + 1);
    }
  }
  const extent = Number.isFinite(min) ? [min, max] : null;
  const categorical = isTechnologyMode || isCallDrop || isIdentifierKpi(key) || !extent;
  const categoryLegend = isCallDrop ? (features.length ? [{ ...dropLegendEntry }] : [])
    : categorical ? colorMapCategories(features) : [];
  if (pciRat) categoryLegend.sort((a, b) => pciCounts.get(b.value) - pciCounts.get(a.value));
  for (const entry of categoryLegend) {
    const bands = channelBands.get(entry.value);
    if (bands) entry.channelBands = [...bands].sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
    const names = pciNames.get(entry.value);
    if (names) entry.cells = [...names].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, exact]) => ({ name, exact }));
  }
  const thresholdLegend = categorical || (legendMode === 'ue' && !thresholdOverride) ? []
    : applyMapThresholds(key, features, { multipleDevices: legendMode === 'thresholds' || Boolean(thresholdOverride), override: thresholdOverride });
  const ueColors = !categorical && (legendMode === 'ue' || (supportsMapThresholds(key) && !thresholdLegend.length));
  const valueLegend = !categorical && !ueColors && !thresholdLegend.length ? colorMapValues(features, extent) : [];
  const snapshotDays = [...new Set([...indexes.keys()].map(({ day }) => day))].sort();
  return { samples: { type: 'FeatureCollection', features }, sites: { type: 'FeatureCollection', features: [...sites.values()] },
    extent, categoryLegend, thresholdLegend, valueLegend, ueColors, sectors: [...sectors.values()], snapshotDays, pciRat };
}

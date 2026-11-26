import './style.css';
import { binsPerPage, callDropKey, chart, datasets, deviceName, dropSeriesLegend, escapeMarkup, format, groupDatasets, hasMappedSamples, legend, legendImage, markLimit, metricName, modes, sourceTable, toSvg } from './charts.js';
import { mapLegendEntryLabel, mapLegendExportEntry, mapLegendFilter, mapPointLegend } from './map-colors.js';
import { importFiles, orderWorkbookBatch, workerRequest } from './workers.js';
import { cellDescription, createMapView } from './map-view.js';
import { supportsMapThresholds } from './map-thresholds.js';
import { detectedCellOverlay, linkedPciCells, mapSectors, sectorLegendGroups } from './sector-style.js';
import { mapImage, stackImages, svgImage } from './image-export.js';
import { loadImports, loadWorkspace, saveImports, saveWorkspace } from './saved-imports.js';
import { parseWorkspace, validateWorkspace, workspaceSnapshot } from './workspace.js';
import { captureReportMaps } from './report-maps.js';
import { reportOptions } from './report-options.js';
import { sortableList } from './sortable-list.js';
import { mapWorkbook, snapshotDateRequired } from './geo.js';
import { positionSurvey } from './indoor.js';

const $ = id => document.getElementById(id);
const themeSwitch = $('theme-switch');
const themeHorizon = themeSwitch.querySelector('.theme-horizon');
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const themeKey = 'surveyor-theme';
let themePreference;
try {
  const savedTheme = localStorage.getItem(themeKey);
  if (savedTheme === 'light' || savedTheme === 'dark') themePreference = savedTheme;
} catch (error) {
  console.warn('Could not read the Surveyor theme preference.', error);
}

function applyTheme() {
  const dark = themePreference ? themePreference === 'dark' : systemTheme.matches;
  const next = dark ? 'dark' : 'light';
  const previous = document.documentElement.dataset.theme;
  document.documentElement.dataset.theme = next;
  themeSwitch.setAttribute('aria-checked', String(dark));
  if (!previous || previous === next) return;

  for (const animation of themeHorizon.getAnimations()) animation.cancel();
  const duration = Math.max(0, ...themeSwitch.getAnimations({ subtree: true })
    .map(animation => animation.effect.getComputedTiming().endTime));
  if (duration > 0) themeHorizon.animate([
    { opacity: 0 }, { opacity: .7, offset: .18 }, { opacity: .7, offset: .75 }, { opacity: 0 },
  ], duration);
}

applyTheme();
systemTheme.addEventListener('change', applyTheme);
themeSwitch.addEventListener('click', () => {
  themePreference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  try {
    localStorage.setItem(themeKey, themePreference);
  } catch (error) {
    console.warn('Could not save the Surveyor theme preference.', error);
  }
});

let surveys = [];
let selectedWorkbooks = null;
let keys = [];
let page = 0;
let importing = false;
let restoring = true;
let reporting = false;
let active;
let installEvent;
let snapshots = [];
let plans = [];
let mapView;
let basemapReady = false;
let mapSequence = 0;
// Chosen map orientation: floor plans keep their own bearing; outdoor maps share this one.
let outdoorBearing = 0;
let mapPlan;
let planSaveTimer;
// The basemap picked by the user; non-georeferenced plans show "no basemap" without forgetting it.
let chosenBasemap = $('basemap').value;
function savePlansSoon() {
  clearTimeout(planSaveTimer);
  planSaveTimer = setTimeout(persistIfKept, 600);
}
function storeBearing(bearing) {
  if (!mapPlan) {
    outdoorBearing = bearing;
    return;
  }
  if ((mapPlan.bearing || 0) === bearing) return;
  mapPlan.bearing = bearing;
  savePlansSoon();
}
const gisRequest = data => workerRequest(new Worker(new URL('./gis.worker.js', import.meta.url), { type: 'module' }), data);
const planRequest = data => workerRequest(new Worker(new URL('./plan.worker.js', import.meta.url), { type: 'module' }), data);
const planFor = survey => survey && plans.find(plan => plan.id === survey.planId);
const positioned = new WeakMap();
// Surveys as they are plotted: rows assigned to a floor plan are repositioned onto it.
function viewSurvey(survey) {
  const plan = planFor(survey);
  if (!plan) return survey;
  const cached = positioned.get(survey);
  if (cached?.plan === plan) return cached.survey;
  const result = positionSurvey(survey, plan);
  positioned.set(survey, { plan, survey: result });
  return result;
}
const viewSurveys = () => surveys.map(viewSurvey);
const explorerViews = () => surveys.flatMap((survey, sourceIndex) =>
  !selectedWorkbooks || selectedWorkbooks.has(survey) ? [{ ...viewSurvey(survey), sourceIndex }] : []);

function persistIfKept() {
  if ($('keep-imports').checked) void persistImports();
}

function storageStatus(message) {
  $('storage-status').hidden = !message;
  $('storage-status').textContent = message;
}

function sourceStatus(id, message, issue = false) {
  const status = $(id);
  status.classList.toggle('visually-hidden', !issue);
  status.textContent = message;
}

async function persistImports() {
  try {
    const keep = $('keep-imports').checked;
    await saveImports(keep ? { surveys, snapshots, plans, workbookOrderSaved: true } : null);
    storageStatus(keep ? 'Imports saved locally in this browser.' : 'Saved imports removed from this browser.');
  } catch (error) {
    storageStatus(`Could not update saved imports: ${error.message}`);
  }
}

const list = (element, items) => {
  const fragment = document.createDocumentFragment();
  for (const value of items) {
    const item = document.createElement('li');
    item.textContent = value;
    fragment.append(item);
  }
  element.replaceChildren(fragment);
};

function renderLegend(title, entries, filter, showCounts = false) {
  const cellLabels = entry => (entry.cells || []).map(({ name, exact }) => exact ? name : `${name} (candidate)`);
  active.legend = { title, entries: filter ? entries.map(entry => mapLegendExportEntry(entry, showCounts)) : entries };
  $('legend-title').textContent = title;
  $('legend-title').hidden = title === 'KPI thresholds';
  $('legend-filter').hidden = !filter || !entries.length;
  $('legend-endpoints').hidden = !filter || (active.map?.extent?.[0] === active.map?.extent?.[1]) || !active.map?.valueLegend.length;
  $('legend-show-all').setAttribute('aria-pressed', 'true');
  $('legend-filter-status').textContent = '';
  const legendList = $('legend');
  legendList.classList.toggle('legend-grid', Boolean(filter));
  legendList.classList.toggle('sinr-legend', Boolean(filter && showCounts));
  legendList.classList.toggle('threshold-legend', Boolean(filter && active.map?.thresholdLegend.length));
  const longest = entries.reduce((max, entry) => (entry.cells || []).reduce(
    (width, { name }) => Math.max(width, name.length), Math.max(max, mapLegendEntryLabel(entry, showCounts).length)), 0);
  legendList.style.setProperty('--legend-box-width', `${Math.min(40, Math.max(16, longest + 11))}ch`);
  renderSwatches(legendList, entries);
  if (!filter) return;
  [...legendList.children].forEach((item, index) => {
    const entry = entries[index];
    const button = document.createElement('button');
    const label = document.createElement('span');
    const percentage = document.createElement('span');
    button.type = 'button';
    button.disabled = !entry.count;
    button.setAttribute('aria-controls', 'survey-map');
    button.setAttribute('aria-pressed', 'false');
    percentage.className = 'legend-share';
    percentage.textContent = entry.share;
    label.className = 'legend-label';
    label.textContent = mapLegendEntryLabel(entry, showCounts);
    const names = cellLabels(entry);
    if (names.length) {
      const cells = document.createElement('span');
      cells.className = 'legend-cells';
      cells.textContent = ` — ${names.join(', ')}`;
      label.append(cells);
    }
    button.append(item.firstElementChild, label, percentage);
    button.addEventListener('click', () => applyLegendFilter(entry, button));
    item.replaceChildren(button);
  });
  if (active.map?.pciRat && entries.some(entry => entry.cells?.length)) {
    legendList.classList.add('measure-pci-legend');
    const width = [...legendList.querySelectorAll('button')].reduce(
      (max, button) => Math.max(max, button.getBoundingClientRect().width), 0);
    legendList.classList.remove('measure-pci-legend');
    legendList.style.setProperty('--legend-box-width', `max(16ch, ${Math.ceil(width)}px)`);
  }
}

function applyLegendFilter(entry, button) {
  if (!active?.legendFilter || active.isolated === entry) return;
  active.isolated = entry;
  active.visibleSamples = active.legendFilter.samples(entry);
  $('legend').querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
  button?.setAttribute('aria-pressed', 'true');
  $('legend-show-all').setAttribute('aria-pressed', String(!entry));
  const count = active.visibleSamples.features.length;
  const plotted = mapView.setSamples(active.visibleSamples);
  if (detectedOnly()) refreshSiteOverlay();
  if (active.map.pciRat) {
    const cells = entry && $('show-sites').checked ? linkedPciCells(active.map, active.visibleSamples) : [];
    mapView.fit(cells);
  }
  $('legend-filter-status').textContent = entry
    ? `Showing ${format(count)} of ${format(active.map.samples.features.length)} mapped samples: ${entry.label}.`
      + (plotted < count ? ` Map preview draws ${format(plotted)} points.` : '')
    : 'Showing all mapped samples.';
  page = 0;
  active.pages = Math.max(1, Math.ceil(count / 100));
  renderPagination();
  renderTable();
}

function renderSwatches(element, entries) {
  list(element, entries.map(entry => entry.label));
  [...element.children].forEach((item, index) => {
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.backgroundColor = entries[index].color;
    swatch.setAttribute('aria-hidden', 'true');
    item.prepend(swatch);
  });
}

const detectedOnly = () => Boolean(active?.map?.pciRat && $('site-detected-only').checked);

function siteOverlay() {
  const { map, visibleSamples } = active;
  const overlay = { sites: map.sites, sectors: mapSectors(map, $('site-pci-colors').checked) };
  return detectedOnly() ? detectedCellOverlay({ ...overlay, pciRat: map.pciRat }, visibleSamples) : overlay;
}

function refreshSiteOverlay() {
  if (!active?.map) return;
  active.siteOverlay = siteOverlay();
  mapView.setSiteOverlay(active.siteOverlay);
  renderSectorLegend();
}

function sectorLegend() {
  if (!$('show-sites').checked || active?.mode !== 'map' || !active.map) return [];
  return sectorLegendGroups(active.siteOverlay.sectors);
}

function renderSectorLegend() {
  const groups = sectorLegend();
  $('sector-key').hidden = !groups.length;
  $('sector-legend').replaceChildren(...groups.map(({ rat, entries }) => {
    const row = document.createElement('div'), title = document.createElement('h5'), values = document.createElement('ul');
    title.textContent = rat;
    renderSwatches(values, entries);
    row.append(title, values);
    return row;
  }));
}

function controls() {
  $('files').disabled = restoring || importing || reporting;
  $('workspace').disabled = restoring || importing || reporting || $('catalogs').disabled || $('plans').disabled;
  $('report').disabled = importing || reporting || !surveys.length;
  $('clear').disabled = importing || reporting || !surveys.length;
  for (const control of $('source-list').querySelectorAll('button, select')) control.disabled = importing || reporting;
}

function filename(value) {
  return value.trim().replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 100).toLowerCase() || 'survey';
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const cell = value => escapeMarkup(typeof value === 'number' ? format(value) : value ?? 'Not reported');
const table = (headers, rows) =>
  `<table aria-labelledby="source-table-title"><thead><tr>${headers.map(header => `<th scope="col">${cell(header)}</th>`).join('')}</tr></thead>
   <tbody>${rows.map(([label, ...values]) => `<tr><th scope="row">${cell(label)}</th>${values.map(value => `<td>${cell(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

const mapGlyph = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/></svg>';

function renderTable() {
  if (!active || !$('data-details').open) return;
  const { mode, title, items, rows } = active;
  const mapRows = mode === 'map' ? active.visibleSamples?.features.slice(page * 100, (page + 1) * 100) || [] : [];
  const heading = $('source-table-title');
  heading.textContent = mode === 'series' ? `${title}: source samples on this page` : title;
  if (mode === 'map') {
    const suffix = document.createElement('span');
    const description = document.createElement('em');
    description.textContent = 'geolocated samples on this page';
    suffix.append(': ', description);
    heading.append(suffix);
  }
  $('table').innerHTML = mode === 'map'
    ? table(['Device', 'Row', 'Longitude', 'Latitude', 'Value', 'Network', 'LTE association', 'NR association', 'Site link'],
      mapRows.map(({ geometry, properties: props }) => [
        props.DEVICE, props.LOG_ROW, ...geometry.coordinates.map(String), props.CATEGORY || props.VALUE, props.NETWORK,
        cellDescription(props, 'L') || null, cellDescription(props, 'N') || null, '—',
      ]))
    : mode === 'series'
    ? table(['Device', 'Workbook row position', 'Value'], rows)
    : table([mode === 'histogram' ? 'Range or category' : 'Statistic', ...items.map(item => `${item.tag} ${item.name}`)],
      rows.map(({ label, values }) => [label, ...values]));
  if (mode === 'map') $('table').querySelectorAll('tbody tr').forEach((row, index) => {
    const sample = mapRows[index];
    if (!sample.siteLinks) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'source-map-button';
    button.innerHTML = mapGlyph;
    button.title = 'Show on map';
    button.setAttribute('aria-label', `Show ${sample.properties.DEVICE} row ${sample.properties.LOG_ROW} on map`);
    button.addEventListener('click', () => {
      $('show-sites').checked = true;
      updateSiteControls();
      mapView.setCells(true);
      renderSectorLegend();
      mapView.selectSample(sample);
      $('survey-map').focus();
    });
    row.lastElementChild.replaceChildren(button);
  });
}

function renderChart(preserveSelection = false) {
  const key = $('metric').value;
  const mode = $('mode').value;
  const title = metricName(key);
  const views = explorerViews();
  const allItems = datasets(views, key, mode);
  if (!allItems.length) return;
  const groups = groupDatasets(allItems);
  const group = $('workbook-group').selectedIndex;
  const items = groups[group];
  const groupSuffix = groups.length > 1 ? `-group-${group + 1}` : '';
  const isMap = mode === 'map';
  const fullRows = mode === 'series' || isMap ? [] : sourceTable(items);
  const perPage = mode === 'series' ? 100 : binsPerPage;
  const total = isMap ? 1 : mode === 'series' ? items.reduce((count, item) => count + item.data.length, 0) : fullRows.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  page = Math.min(page, pages - 1);
  const start = page * perPage;
  const rows = mode === 'series' ? [] : fullRows.slice(start, start + perPage);
  if (mode === 'series') {
    let remainingOffset = start;
    for (const item of items) {
      if (remainingOffset >= item.data.length) {
        remainingOffset -= item.data.length;
        continue;
      }
      rows.push(...item.data.slice(remainingOffset, remainingOffset + perPage - rows.length)
        .map(([position, value]) => [`${item.tag} ${item.name}`, position, value]));
      remainingOffset = 0;
      if (rows.length === perPage) break;
    }
  }
  const plot = mode === 'statistics' || isMap ? null : chart(title, mode, items, mode === 'series' ? 0 : page);
  active = { key, title, mode, items, rows, plot, pages, groupSuffix, views };
  $('chart-title').textContent = `${title} — ${modes[mode]}`;
  const missing = views.length - allItems.length;
  const dropSeries = key === callDropKey && mode === 'series';
  const interpretation = dropSeries
    ? total ? 'Each point marks a detected call drop. Workbook row positions are not time-aligned.' : 'No call drops detected in this workbook group.'
    : mode === 'histogram'
    ? 'Counts and ranges come from the workbooks. An omitted bin is not a reported zero.'
    : mode === 'series'
      ? `Workbook row positions are not time-aligned. For dense traces, the plot keeps up to ${markLimit} points per device; the source table retains every numeric reading.`
      : isMap ? '' : 'Statistics are displayed as reported, not recalculated across devices.';
  const availability = missing ? `${missing} of ${views.length} selected workbooks did not report this view.` : '';
  $('interpretation').textContent = [interpretation, availability].filter(Boolean).join(' ');
  $('interpretation').hidden = !interpretation && !availability;
  $('visual').hidden = !plot;
  $('visual').innerHTML = plot ? toSvg(plot) : '';
  for (const id of ['export-chart', 'copy-plot', 'export-both']) $(id).hidden = !plot && !isMap;
  if (!isMap) setMapImageActions(false);
  updateImageLabels();
  if (isMap) renderLegend('Legend', []);
  else if (dropSeries) renderLegend('Legend', dropSeriesLegend(items));
  else renderLegend('Legend', items.map(({ tag, name, color }) => ({ label: `${tag} ${name}`, color })));
  renderPagination();
  $('map-panel').hidden = !isMap;
  if (isMap) renderMap(preserveSelection);
  else resetMap();
  if (mode === 'statistics') $('data-details').open = true;
  renderTable();
}

function renderPagination() {
  const { mode, pages } = active;
  $('pagination').hidden = pages <= 1 || mode !== 'histogram';
  $('source-pagination').hidden = pages <= 1;
  for (const prefix of ['', 'source-']) {
    $(`${prefix}previous`).setAttribute('aria-disabled', String(page === 0));
    $(`${prefix}next`).setAttribute('aria-disabled', String(page >= pages - 1));
  }
  $('page').textContent = `Page ${page + 1} of ${pages}`;
  $('source-page').setAttribute('aria-live', mode === 'histogram' ? 'off' : 'polite');
  $('source-page').textContent = `Source values ${page + 1} of ${pages}`;
}

function resetMap() {
  mapSequence++;
  basemapReady = false;
  $('site-controls').hidden = true;
  mapView?.setBasemap('local');
  mapView?.clear();
}

function setMapActions(disabled) {
  for (const id of ['fit-map', 'download-kml', 'download-shp']) $(id).disabled = disabled;
  setMapImageActions(disabled);
}

function setMapImageActions(disabled) {
  for (const id of ['export-chart', 'copy-plot', 'export-legend', 'export-both']) $(id).disabled = disabled;
}

async function renderMap(preserveSelection = false) {
  const request = ++mapSequence;
  page = 0;
  delete active.map;
  delete active.visibleSamples;
  delete active.legendFilter;
  delete active.isolated;
  updateSiteControls();
  renderLegend('Legend', []);
  renderSectorLegend();
  active.pages = 1;
  renderPagination();
  renderTable();
  setMapActions(true);
  $('map-scale').hidden = true;
  const canChooseLegend = active.views.length > 1 && supportsMapThresholds(active.key);
  $('map-legend-field').hidden = !canChooseLegend;
  const legendMode = canChooseLegend ? ($('map-legend').checked ? 'thresholds' : 'ue') : 'auto';
  const plan = planFor(active.views[active.items[0].index]);
  const planar = Boolean(plan?.planar);
  if (mapView && mapView.planar !== planar) {
    mapView.destroy();
    mapView = undefined;
    basemapReady = false;
  }
  if (!mapView) {
    mapView = createMapView($('survey-map'), $('basemap'), (message, retry) => {
      $('basemap-status').textContent = message;
      $('basemap-status').hidden = !message;
      $('retry-basemap').hidden = !retry;
    }, false,
      { planar, onRotate: storeBearing, onRotating: showPlanBearing });
    mapView.setSiteStyle(siteStyle());
    mapView.setHoverLinks($('show-hover-links').checked);
    if ($('basemap').querySelector(`option[value="${chosenBasemap}"]`)?.disabled) chosenBasemap = 'local';
  }
  mapPlan = plan;
  $('basemap').value = planar ? 'local' : chosenBasemap;
  $('basemap').disabled = planar;
  mapView.setFloorPlan(plan || null);
  mapView.setPlanStyle({ transparency: plan?.transparency, hidden: plan?.hidden });
  mapView.setBearing(plan ? plan.bearing || 0 : outdoorBearing);
  updatePlanControls();
  if (!preserveSelection || !mapView.selectedDevice()) mapView.clear();
  sourceStatus('map-status', 'Preparing map…');
  const gap = $('snapshot-gap');
  if (snapshots.length && !planar && !gap.validity.valid) {
    sourceStatus('map-status', 'Enter a whole number of days (0 or more) for the snapshot gap.', true);
    return;
  }
  try {
    const { views } = active;
    const { map } = await gisRequest({ type: 'map', key: active.key, snapshots: planar ? [] : snapshots, maxDays: gap.valueAsNumber, legendMode,
      workbooks: active.items.map(({ index, tag, color }) => mapWorkbook(views[index], active.key, tag, color)) });
    if (request !== mapSequence) return;
    active.map = map;
    updateSiteControls();
    active.visibleSamples = map.samples;
    active.siteOverlay = siteOverlay();
    renderSectorLegend();
    const { title, entries, showCounts } = mapPointLegend(active.key, map, active.items);
    if (active.key === callDropKey) renderLegend(title, entries);
    else {
      active.legendFilter = mapLegendFilter(map, entries);
      renderLegend(title, active.legendFilter.entries, active.legendFilter, showCounts);
    }
    active.pages = Math.max(1, Math.ceil(map.samples.features.length / 100));
    const { plotted, sitesPlotted } = mapView.render({ ...map, ...active.siteOverlay },
      $('show-sites').checked, preserveSelection);
    const count = map.samples.features.length, siteCount = map.sites.features.length;
    basemapReady ||= Boolean(count || plan);
    mapView.setBasemap(basemapReady ? chosenBasemap : 'local');
    updatePlanControls();
    $('map-scale').hidden = !map.ueColors;
    $('map-scale').textContent = map.ueColors ? 'Point colours identify the UE, not the KPI value.' : '';
    sourceStatus('map-status', `${format(count)} ${plan ? `samples on floor plan ${plan.name}` : `geolocated ${count === 1 ? 'sample' : 'samples'}`}`
      + (planar ? ' (not georeferenced: blank basemap, no Actix matching or KML/SHP export).' : ` · ${format(siteCount)} associated Actix ${siteCount === 1 ? 'cell' : 'cells'}.`)
      + (plotted < count || sitesPlotted < active.siteOverlay.sites.features.length ? ` Map preview shows ${format(plotted)} samples and ${format(sitesPlotted)} cells; GIS downloads include all points.` : ''));
    setMapActions(!count);
    if (planar) for (const id of ['download-kml', 'download-shp', 'basemap']) $(id).disabled = true;
    renderPagination();
    renderTable();
  } catch (error) {
    if (request === mapSequence) sourceStatus('map-status', `Map could not be prepared: ${error.message}`, true);
  }
}

function renderGroups(preserveSelection = false, preferredGroup = 0) {
  const groups = groupDatasets(datasets(explorerViews(), $('metric').value, $('mode').value));
  const select = $('workbook-group');
  select.replaceChildren();
  for (const items of groups) {
    const first = items[0].tag;
    const last = items.at(-1).tag;
    const plan = items[0].plan && plans.find(item => item.id === items[0].plan);
    select.add(new Option(`${first === last ? first : `${first}–${last}`}${plan ? ` · ${plan.name}` : ''}`));
  }
  $('workbook-groups').hidden = groups.length <= 1;
  if (preferredGroup < groups.length) select.selectedIndex = preferredGroup;
  if (preserveSelection) {
    const device = mapView?.selectedDevice();
    const index = groups.findIndex(items => items.some(item => item.tag === device));
    if (index >= 0) select.selectedIndex = index;
  }
  page = 0;
  renderChart(preserveSelection);
}

function renderModes(preferred, preserveSelection = false, preferredGroup = 0) {
  const key = $('metric').value, views = explorerViews();
  const available = Object.keys(modes).filter(mode => datasets(views, key, mode).length);
  $('mode').replaceChildren(...available.map(mode => new Option(modes[mode], mode)));
  if (available.includes(preferred)) $('mode').value = preferred;
  else if (key === callDropKey && available.includes('series')) $('mode').value = 'series';
  renderGroups(preserveSelection && $('mode').value === 'map', preferredGroup);
}

function removeWorkbook(index) {
  const [removed] = surveys.splice(index, 1);
  selectedWorkbooks?.delete(removed);
  if (selectedWorkbooks?.size === surveys.length) selectedWorkbooks = null;
  renderSurvey(false);
  sourceStatus('status', `Removed ${removed.filename}. ${surveys.length
    ? `${surveys.length} ${surveys.length === 1 ? 'workbook' : 'workbooks'} remaining.`
    : 'No workbooks imported.'}`);
  const buttons = $('source-list').querySelectorAll('button[data-remove]');
  (buttons[Math.min(index, buttons.length - 1)] || $('files')).focus();
  if ($('keep-imports').checked) void persistImports();
}

const rowSurvey = new WeakMap();
function updateWorkbookRow(row, index) {
  const survey = rowSurvey.get(row);
  const tag = `S${index + 1}`;
  const name = row.querySelector('.workbook-name');
  const number = document.createElement('strong');
  number.textContent = tag;
  name.replaceChildren(number, ` ${deviceName(survey)} · ${survey.filename} · ${format(survey.rows)} series rows`);
  row.querySelector('[data-sort-handle]')?.setAttribute('aria-label', `Reorder workbook ${tag}: ${survey.filename}`);
  row.querySelector('[data-remove]').setAttribute('aria-label', `Remove workbook ${tag}: ${survey.filename}`);
  const planLabel = row.querySelector('.plan-select > .visually-hidden');
  if (planLabel) planLabel.textContent = `Floor plan for ${tag}`;
}

const workbookSort = sortableList($('source-list'), (row, rows) => {
  surveys = rows.map(item => rowSurvey.get(item));
  rows.forEach(updateWorkbookRow);
  renderSurvey(false, false);
  sourceStatus('status', `${rowSurvey.get(row).filename} moved to S${rows.indexOf(row) + 1}.`);
  persistIfKept();
}, { scroll: document.scrollingElement, blocked: () => importing || reporting });

function renderWorkbookList() {
  workbookSort.cancel();
  $('workbook-order-hint').hidden = surveys.length < 2;
  $('source-list').replaceChildren(...surveys.map((survey, index) => {
    const item = document.createElement('li');
    const label = document.createElement('span');
    const button = document.createElement('button');
    rowSurvey.set(item, survey);
    label.className = 'workbook-name';
    if (surveys.length > 1) {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.dataset.sortHandle = '';
      handle.setAttribute('aria-describedby', 'workbook-order-hint');
      const glyph = document.createElement('span');
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = '\u22ee\u22ee';
      handle.append(glyph);
      item.append(handle);
    }
    button.type = 'button';
    button.className = 'danger-action';
    button.dataset.remove = '';
    button.textContent = '×';
    button.addEventListener('click', () => removeWorkbook(surveys.indexOf(survey)));
    item.append(label);
    if (plans.length) {
      const field = document.createElement('label');
      const select = document.createElement('select');
      field.className = 'plan-select';
      field.append(Object.assign(document.createElement('span'), { className: 'visually-hidden' }), select);
      if (CSS.supports('appearance: base-select') && 'HTMLSelectedContentElement' in window) {
        const selected = document.createElement('button');
        selected.type = 'button';
        selected.append(document.createElement('selectedcontent'));
        select.append(selected);
      }
      select.add(new Option('No floor plan', ''));
      for (const plan of plans) {
        const option = new Option('', plan.id);
        const name = document.createElement('strong');
        name.textContent = plan.name;
        option.append('Floor plan: ', name);
        select.add(option);
      }
      select.value = planFor(survey) ? survey.planId : '';
      select.addEventListener('change', () => {
        if (select.value) survey.planId = select.value;
        else delete survey.planId;
        const plan = planFor(survey);
        sourceStatus('plan-status', `S${surveys.indexOf(survey) + 1} ${plan ? `placed on floor plan ${plan.name}` : 'uses its workbook positions'}.`);
        renderSurvey();
        persistIfKept();
      });
      item.append(field);
    }
    item.append(button);
    updateWorkbookRow(item, index);
    return item;
  }));
}

function renderSurvey(preferMap = true, rebuildSources = true, view) {
  $('results').hidden = !surveys.length;
  $('sources').hidden = !surveys.length;
  if (rebuildSources) renderWorkbookList();
  renderExplorerWorkbooks();
  renderExplorer(preferMap, view);
}

const workbookChoices = $('explorer-workbook-list');
const allWorkbooksChoice = $('explorer-workbooks-all');
function updateExplorerWorkbooks() {
  const count = selectedWorkbooks?.size ?? surveys.length;
  $('explorer-workbook-count').textContent = `(${count} of ${surveys.length})`;
  $('explorer-empty').hidden = !surveys.length || count > 0;
  allWorkbooksChoice.checked = count === surveys.length;
  allWorkbooksChoice.indeterminate = count > 0 && count < surveys.length;
}

function renderExplorerWorkbooks() {
  $('explorer-workbooks').hidden = surveys.length < 2 && !selectedWorkbooks;
  workbookChoices.replaceChildren(...surveys.map((survey, index) => {
    const label = document.createElement('label');
    label.className = 'checkbox-label';
    const choice = document.createElement('input');
    choice.type = 'checkbox';
    choice.checked = !selectedWorkbooks || selectedWorkbooks.has(survey);
    choice.addEventListener('change', () => {
      selectedWorkbooks ??= new Set(surveys);
      if (choice.checked) selectedWorkbooks.add(survey);
      else selectedWorkbooks.delete(survey);
      if (selectedWorkbooks.size === surveys.length) selectedWorkbooks = null;
      updateExplorerWorkbooks();
      renderExplorer(false);
    });
    const text = document.createElement('span');
    const tag = document.createElement('strong');
    tag.textContent = `S${index + 1}`;
    text.append(tag, ` ${deviceName(survey)} · ${survey.filename}`);
    label.append(choice, text);
    return label;
  }));
  updateExplorerWorkbooks();
}

allWorkbooksChoice.addEventListener('change', () => {
  selectedWorkbooks = allWorkbooksChoice.checked ? null : new Set();
  for (const choice of workbookChoices.querySelectorAll('input')) choice.checked = allWorkbooksChoice.checked;
  updateExplorerWorkbooks();
  renderExplorer(false);
});

function renderExplorer(preferMap, view) {
  const previous = view?.metric ?? $('metric').value;
  const views = explorerViews();
  keys = [...new Set(views.flatMap(survey => survey.metrics.map(metric => metric.key)))];
  $('explorer').hidden = !keys.length;
  $('metric').replaceChildren(...keys.map(key => new Option(metricName(key), key)));
  if (keys.includes(previous)) $('metric').value = previous;
  else if (keys.includes('LTE_UE_RSRP')) $('metric').value = 'LTE_UE_RSRP';
  if (keys.length && preferMap) {
    const mappable = new Set(views.flatMap(survey =>
      survey.metrics.filter(metric => hasMappedSamples(survey, metric)).map(metric => metric.key)));
    if (mappable.size && !mappable.has($('metric').value)) $('metric').value = mappable.values().next().value;
    renderModes(mappable.size ? 'map' : $('mode').value);
  } else if (keys.length) {
    renderModes(view?.mode ?? $('mode').value, false, view?.group);
  } else {
    resetMap();
    active = undefined;
    $('table').replaceChildren();
    $('visual').replaceChildren();
    $('legend').replaceChildren();
    $('legend-filter').hidden = true;
  }
  controls();
}

$('files').addEventListener('change', async event => {
  const files = [...event.target.files];
  event.target.value = '';
  if (!files.length) return;
  importing = true;
  controls();
  $('issues').hidden = true;
  sourceStatus('status', `Reading ${files.length} workbooks…`);
  try {
    const results = await importFiles(files, done => {
      sourceStatus('status', `Read ${done} of ${files.length} workbooks.`);
    });
    const imported = results.flatMap(result => result.survey ? [result.survey] : []);
    const issues = results.flatMap(({ survey, filename, error }) => survey
      ? survey.warnings.map(warning => `${survey.filename}: ${warning}`)
      : [`${filename}: ${error}`]);
    list($('issues'), issues);
    $('issues').hidden = !issues.length;
    if (imported.length) {
      const placed = assignPlans(imported, plans);
      surveys = [...surveys, ...orderWorkbookBatch(imported)];
      renderSurvey();
      if (placed) sourceStatus('plan-status', `${placed} ${placed === 1 ? 'workbook' : 'workbooks'} placed on imported floor plans.`);
      if ($('keep-imports').checked) await persistImports();
    }
    sourceStatus('status', imported.length
      ? `Imported ${imported.length} of ${files.length} selected workbooks. ${surveys.length} ${surveys.length === 1 ? 'workbook' : 'workbooks'} in this survey. ${keys.length} KPIs available.`
      : 'No workbooks could be imported. The current survey has not changed.', !imported.length);
  } catch (error) {
    sourceStatus('status', `Import failed: ${error.message}`, true);
  } finally {
    importing = false;
    controls();
  }
});

$('clear').addEventListener('click', () => {
  surveys = [];
  selectedWorkbooks = null;
  $('location').value = '';
  $('issues').replaceChildren();
  $('issues').hidden = true;
  sourceStatus('status', 'Survey cleared.');
  renderSurvey();
  if ($('keep-imports').checked) void persistImports();
  $('files').focus();
});
$('metric').addEventListener('change', () => renderModes($('mode').value, $('mode').value === 'map'));
$('mode').addEventListener('change', () => renderGroups());
$('workbook-group').addEventListener('change', () => { page = 0; renderChart(); });
function turnPage(offset) {
  const next = page + offset;
  if (!active || next < 0 || next >= active.pages) return;
  page = next;
  if (active.mode === 'map') { renderPagination(); renderTable(); }
  else renderChart();
}
for (const prefix of ['', 'source-']) {
  $(`${prefix}previous`).addEventListener('click', () => turnPage(-1));
  $(`${prefix}next`).addEventListener('click', () => turnPage(1));
}
$('data-details').addEventListener('toggle', renderTable);
function exportStatus(text) {
  $('export-status').hidden = false;
  $('export-status').textContent = text;
}
function updateImageLabels() {
  const name = $('image-format').value.toUpperCase();
  for (const [id, label] of [['export-chart', active?.mode === 'map' ? 'Map image' : 'Plot'],
    ['export-legend', 'Legend'], ['export-both', 'Both']]) {
    $(id).querySelector('span').textContent = `${label} (${name})`;
    $(id).setAttribute('aria-label', `Download ${label.toLowerCase()} (${name})`);
  }
}
$('image-format').addEventListener('change', updateImageLabels);

const asImage = model => ({ width: model.width, height: model.height, svg: toSvg(model) });
function currentPlotImage() {
  return active.mode === 'map' ? mapImage($('survey-map'), `${active.title} — Map plot`) : asImage(active.plot);
}

async function exportImage(kind) {
  const ext = $('image-format').value;
  const pageSuffix = kind !== 'legend' && active.mode === 'histogram' && active.pages > 1 ? `-${page + 1}` : '';
  const suffix = { plot: '', legend: '-legend', both: '-with-legend' }[kind];
  const name = `${filename(active.key)}-${active.mode}${active.groupSuffix}${pageSuffix}${suffix}.${ext}`;
  try {
    let svg;
    if (kind === 'plot') svg = currentPlotImage().svg;
    else {
      const usePointLegend = active.mode === 'map' || (active.key === callDropKey && active.mode === 'series');
      const key = asImage(usePointLegend ? legendImage(active.legend.title, active.legend.entries) : legend(active.title, active.items));
      const legends = [key, ...sectorLegend().map(({ rat, entries }) => asImage(legendImage(`Actix sector legend — ${rat}`, entries)))];
      svg = kind === 'both' ? stackImages(`${active.title} — plot and legend`, currentPlotImage(), ...legends)
        : legends.length > 1 ? stackImages(`${active.title} — legends`, ...legends) : key.svg;
    }
    download(await svgImage(svg, ext), name);
    exportStatus(`${{ plot: 'Plot', legend: 'Legend', both: 'Plot and legend' }[kind]} download started.`);
  } catch (error) {
    exportStatus(`Image export failed: ${error.message}`);
  }
}
$('copy-plot').addEventListener('click', async () => {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem !== 'function') {
      throw new Error('Image copying is not available in this browser. Download the image instead.');
    }
    const image = svgImage(currentPlotImage().svg, 'png');
    await Promise.all([image, navigator.clipboard.write([new ClipboardItem({ 'image/png': image })])]);
    exportStatus('Plot copied to clipboard as a PNG image.');
  } catch (error) {
    exportStatus(`Could not copy the plot: ${error.message}`);
  }
});
$('export-chart').addEventListener('click', () => exportImage('plot'));
$('export-legend').addEventListener('click', () => exportImage('legend'));
$('export-both').addEventListener('click', () => exportImage('both'));

$('basemap').addEventListener('change', event => {
  chosenBasemap = event.target.value;
  if (basemapReady) mapView.setBasemap(chosenBasemap);
  updatePlanControls();
});
$('retry-basemap').addEventListener('click', () => {
  if (!basemapReady) return;
  $('basemap').focus();
  mapView.setBasemap(chosenBasemap, true);
});
const normalDegrees = value => Math.round((((value % 360) + 360) % 360) * 10) / 10 % 360;
function showPlanBearing(bearing) {
  const value = normalDegrees(bearing);
  if (document.activeElement !== $('plan-bearing')) $('plan-bearing').value = value;
  $('plan-bearing-range').value = value;
  $('plan-bearing-range').setAttribute('aria-valuetext', `${value}°`);
}
function showPlanTransparency(value) {
  $('plan-transparency').value = value;
  $('plan-transparency-value').textContent = `${value}%`;
  $('plan-transparency').setAttribute('aria-valuetext', `${value}%`);
}
// Floor plan options: transparency always, and an orientation prompt while the plan is the basemap.
function updatePlanControls() {
  $('basemap').querySelector('option[value="local"]').textContent = mapPlan && !mapPlan.hidden ? 'No basemap (floor plan only)' : 'No basemap';
  $('plan-controls').hidden = !mapPlan;
  if (!mapPlan) return;
  $('plan-controls-name').textContent = mapPlan.name;
  $('plan-hide').checked = Boolean(mapPlan.hidden);
  showPlanTransparency(mapPlan.transparency || 0);
  const asBasemap = Boolean(mapView?.planIsBasemap());
  $('plan-orientation').hidden = !asBasemap || Boolean(mapPlan.hidden);
  const confirmed = Boolean(mapPlan.orientationConfirmed);
  $('plan-orientation').classList.toggle('needs-confirmation', !confirmed);
  const prompt = confirmed
    ? 'Saved with this floor plan and used for its PowerPoint slides. Fine-tune it here or drag the compass on the map.'
    : 'Is the floor plan the right way up? Rotate it until it reads correctly, then confirm. The orientation is saved with the floor plan and used for its PowerPoint slides.';
  if ($('plan-orientation-prompt').textContent !== prompt) $('plan-orientation-prompt').textContent = prompt;
  $('plan-confirm').hidden = confirmed;
  $('plan-align').hidden = Boolean(mapPlan.planar);
  showPlanBearing(mapView?.getBearing() || 0);
}
$('plan-transparency').addEventListener('input', event => {
  const value = event.target.valueAsNumber;
  showPlanTransparency(value);
  if (!mapPlan) return;
  mapPlan.transparency = value;
  mapView?.setPlanStyle(mapPlan);
  savePlansSoon();
});
$('plan-hide').addEventListener('change', event => {
  if (!mapPlan) return;
  mapPlan.hidden = event.target.checked;
  mapView.setPlanStyle(mapPlan);
  updatePlanControls();
  persistIfKept();
});
$('plan-bearing').addEventListener('change', event => {
  const value = event.target.valueAsNumber;
  if (Number.isFinite(value)) mapView?.setBearing(value);
  showPlanBearing(mapView?.getBearing() || 0);
  event.target.value = normalDegrees(mapView?.getBearing() || 0);
});
$('plan-bearing-range').addEventListener('input', event => mapView?.setBearing(event.target.valueAsNumber));
for (const button of document.querySelectorAll('#plan-orientation [data-turn]')) {
  button.addEventListener('click', () => mapView?.setBearing(mapView.getBearing() + Number(button.dataset.turn)));
}
$('plan-align').addEventListener('click', () => mapView?.alignToFloorPlan());
$('plan-confirm').addEventListener('click', () => {
  if (!mapPlan || !mapView) return;
  mapPlan.bearing = mapView.getBearing();
  mapPlan.orientationConfirmed = true;
  persistIfKept();
  updatePlanControls();
  $('plan-bearing').focus();
});
$('legend-show-all').addEventListener('click', () => applyLegendFilter());
$('map-legend').addEventListener('change', () => renderMap(true));
const siteSliders = ['site-size', 'site-transparency'];
const siteStyle = () => ({ size: $('site-size').valueAsNumber, transparency: $('site-transparency').valueAsNumber });
function updateSiteControls() {
  const days = active?.map?.snapshotDays;
  $('site-controls').hidden = !days?.length;
  if (days?.length) $('site-controls-title').textContent = `Sites: ${days.join(', ')}`;
  $('site-pci-colors-field').hidden = !active?.map?.pciRat;
  $('site-detected-only-field').hidden = !active?.map?.pciRat;
  for (const id of ['show-hover-links', 'site-pci-colors', 'site-detected-only', ...siteSliders]) $(id).disabled = !$('show-sites').checked;
}
for (const id of siteSliders) {
  $(id).addEventListener('input', event => {
    const value = `${event.target.value}%`;
    $(`${id}-value`).textContent = value;
    event.target.setAttribute('aria-valuetext', value);
    mapView?.setSiteStyle(siteStyle());
  });
}
$('show-sites').addEventListener('change', event => {
  updateSiteControls();
  mapView?.setCells(event.target.checked);
  renderSectorLegend();
});
$('show-hover-links').addEventListener('change', event => mapView?.setHoverLinks(event.target.checked));
for (const id of ['site-pci-colors', 'site-detected-only']) $(id).addEventListener('change', refreshSiteOverlay);
$('fit-map').addEventListener('click', () => mapView?.fit());
async function exportMap(type) {
  const { map, key, title, groupSuffix } = active;
  const name = `${filename(key)}-map${groupSuffix}`;
  try {
    const { kml, buffer } = await gisRequest({ type, map, title });
    download(new Blob([kml || buffer], { type: kml ? 'application/vnd.google-earth.kml+xml' : 'application/zip' }),
      `${name}.${kml ? 'kml' : 'zip'}`);
    exportStatus('Map download started.');
  } catch (error) {
    exportStatus(`Map export failed: ${error.message}`);
  }
}
$('download-kml').addEventListener('click', () => exportMap('kml'));
$('download-shp').addEventListener('click', () => exportMap('shapefile'));

function renderCatalogs(messages = [], needsDate = false) {
  list($('catalog-list'), snapshots.map(({ rat, day, filename, cells, skipped }) =>
    `${rat} · ${day} · ${filename} · ${format(cells.length)} cells${skipped ? ` (${format(skipped)} rows skipped)` : ''}`));
  $('catalog-list').hidden = !snapshots.length;
  list($('catalog-issues'), messages);
  $('catalog-issues').hidden = !messages.length;
  $('snapshot-date-field').hidden = !snapshots.length && !needsDate;
  $('snapshot-gap-field').hidden = !snapshots.length;
  $('clear-catalogs').disabled = !snapshots.length;
  if (active?.mode === 'map') renderMap();
}
$('catalogs').addEventListener('change', async event => {
  const input = event.target;
  const files = [...input.files];
  if (!files.length) return;
  input.value = '';
  input.disabled = true;
  $('clear-catalogs').disabled = true;
  controls();
  const date = $('snapshot-date').value;
  const messages = [];
  let added = 0;
  let needsDate = false;
  for (const file of files) {
    $('catalog-status').textContent = `Reading ${file.name}…`;
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error('Select an Actix .csv file.');
      const { snapshot } = await gisRequest({ type: 'catalog', file, date });
      snapshots = snapshots.filter(item => item.rat !== snapshot.rat || item.day !== snapshot.day);
      snapshots.push(snapshot);
      added++;
    } catch (error) {
      if (error.message === snapshotDateRequired) needsDate = true;
      messages.push(`${file.name}: ${error.message}`);
    }
  }
  input.disabled = false;
  $('catalog-status').textContent = `Read ${added} of ${files.length} files. ${snapshots.length} dated snapshots available.`;
  renderCatalogs(messages, needsDate);
  if (added && $('keep-imports').checked) await persistImports();
  controls();
});
$('clear-catalogs').addEventListener('click', () => {
  snapshots = [];
  $('snapshot-date').value = '';
  $('catalog-status').textContent = 'Cell snapshots cleared.';
  renderCatalogs();
  if ($('keep-imports').checked) void persistImports();
});
const snapshotGap = $('snapshot-gap');
const gapMotion = $('snapshot-gap-motion');
const reduceGapMotion = matchMedia('(prefers-reduced-motion: reduce)');
let previousGap = snapshotGap.valueAsNumber;
let gapAnimation;
function stopGapAnimation() {
  gapAnimation?.cancel();
  gapAnimation = undefined;
  gapMotion.parentElement.classList.remove('is-rolling');
}
snapshotGap.addEventListener('input', event => {
  const next = snapshotGap.valueAsNumber;
  const direction = Math.sign(next - previousGap);
  previousGap = next;
  stopGapAnimation();
  if (!direction || event.inputType || reduceGapMotion.matches) return;
  gapMotion.textContent = snapshotGap.value;
  gapMotion.parentElement.classList.add('is-rolling');
  gapAnimation = gapMotion.animate([
    { transform: `translateY(${direction * .35}em)`, opacity: 0 },
    { transform: 'translateY(0)', opacity: 1 },
  ], { duration: 170, easing: 'ease-out' });
  gapAnimation.onfinish = stopGapAnimation;
});
reduceGapMotion.addEventListener('change', stopGapAnimation);
snapshotGap.addEventListener('change', () => { if (active?.mode === 'map') renderMap(); });

const baseName = name => name.split(/[\\/]/).pop().replace(/\.[^.]+$/, '').toLowerCase();

function planFits(survey, plan) {
  const located = Object.values(survey.geography).filter(entry => entry.coords).map(entry => entry.coords);
  if (plan.planar) return !located.length;
  if (!located.length) return true;
  const [origin, right, down] = plan.corners;
  const corners = [origin, right, down, [right[0] + down[0] - origin[0], right[1] + down[1] - origin[1]]];
  const [west, east] = [Math.min(...corners.map(point => point[0])), Math.max(...corners.map(point => point[0]))];
  const [south, north] = [Math.min(...corners.map(point => point[1])), Math.max(...corners.map(point => point[1]))];
  const inside = located.filter(([lon, lat]) => lon >= west && lon <= east && lat >= south && lat <= north).length;
  return inside >= located.length / 2;
}

// Places workbooks without a floor plan on a matching plan: same log name as the MRK first, then by location.
function assignPlans(targets, candidates) {
  let placed = 0;
  for (const survey of targets) {
    if (planFor(survey) || !candidates.length) continue;
    const named = candidates.find(plan => plan.markerFile && baseName(plan.markerFile) === baseName(survey.filename) && planFits(survey, plan));
    const plan = named || candidates.find(item => planFits(survey, item));
    if (!plan) continue;
    survey.planId = plan.id;
    placed++;
  }
  return placed;
}

function renderPlans() {
  $('plan-list').replaceChildren(...plans.map(plan => {
    const item = document.createElement('li');
    const label = document.createElement('span');
    const button = document.createElement('button');
    label.textContent = `${plan.name} · ${plan.planar ? `not georeferenced (${plan.units})` : 'georeferenced'} · `
      + `${plan.markers.length ? `${format(plan.markers.length)} markers` : 'no markers'} · ${format(plan.width)}×${format(plan.height)} px`;
    button.type = 'button';
    button.className = 'danger-action';
    button.textContent = '×';
    button.setAttribute('aria-label', `Remove floor plan ${plan.name}`);
    button.addEventListener('click', () => {
      plans = plans.filter(item => item !== plan);
      for (const survey of surveys) if (survey.planId === plan.id) delete survey.planId;
      sourceStatus('plan-status', `Removed floor plan ${plan.name}.`);
      renderPlans();
      renderSurvey(false);
      persistIfKept();
      $('plans').focus();
    });
    item.append(label, button);
    return item;
  }));
  $('plan-list').hidden = !plans.length;
  $('clear-plans').disabled = !plans.length;
}

$('plans').addEventListener('change', async event => {
  const input = event.target;
  const files = [...input.files];
  if (!files.length) return;
  input.value = '';
  input.disabled = true;
  $('clear-plans').disabled = true;
  controls();
  const tabs = files.filter(file => /\.tab$/i.test(file.name));
  const images = files.filter(file => /\.(bmp|png|jpe?g)$/i.test(file.name));
  const markers = files.filter(file => /\.mrk$/i.test(file.name));
  const messages = [];
  const added = [];
  if (!tabs.length) messages.push('Select a .tab file together with its floor-plan image.');
  for (const tab of tabs) {
    sourceStatus('plan-status', `Reading ${tab.name}…`);
    try {
      const imageName = /^\s*File\s+"([^"]+)"/im.exec(await tab.text())?.[1] || '';
      const image = images.find(file => file.name.toLowerCase() === imageName.split(/[\\/]/).pop().toLowerCase())
        || images.find(file => baseName(file.name) === baseName(tab.name)) || (tabs.length === 1 && images.length === 1 ? images[0] : null);
      if (!image) throw new Error(`Also select the floor-plan image ${imageName || 'named in the TAB file'}.`);
      const mrk = markers.find(file => baseName(file.name) === baseName(tab.name)) || (tabs.length === 1 && markers.length === 1 ? markers[0] : null);
      sourceStatus('plan-status', `Preparing floor plan ${image.name}…`);
      const { plan } = await planRequest({ id: crypto.randomUUID(), tab, image, mrk });
      added.push(plan);
    } catch (error) {
      messages.push(`${tab.name}: ${error.message}`);
    }
  }
  plans.push(...added);
  const placed = assignPlans(surveys, added);
  input.disabled = false;
  sourceStatus('plan-status', messages.length ? messages.join(' ') : `Read ${added.length} of ${tabs.length} floor plans.`
    + (placed ? ` ${placed} ${placed === 1 ? 'workbook' : 'workbooks'} placed on the new plans.` : ''), Boolean(messages.length));
  renderPlans();
  if (added.length) {
    renderSurvey();
    persistIfKept();
  }
  controls();
});
$('clear-plans').addEventListener('click', () => {
  plans = [];
  for (const survey of surveys) delete survey.planId;
  sourceStatus('plan-status', 'Floor plans cleared.');
  renderPlans();
  renderSurvey(false);
  persistIfKept();
  $('plans').focus();
});

const reportSurveys = () => viewSurveys().map(survey => ({ ...survey, planName: planFor(survey)?.name }));
reportOptions($('report'), reportSurveys, async ({ surveys: selectedSurveys, keys, sections, thresholdOverrides }) => {
  const location = $('location').value.trim() || 'Network survey';
  const reportStatus = $('report-status');
  const reportProgress = $('report-progress');
  reporting = true;
  controls();
  reportStatus.textContent = 'Generating PowerPoint…';
  reportProgress.value = 0;
  reportProgress.hidden = false;
  try {
    const catalog = snapshots, gap = $('snapshot-gap');
    if (catalog.length && !gap.validity.valid && selectedSurveys.some(survey => survey.metrics.some(metric => keys.includes(metric.key) && metric.geoCount))) {
      throw new Error('Enter a whole number of days (0 or more) for the snapshot gap.');
    }
    let captureShare = 0;
    const maps = await captureReportMaps({
      surveys: selectedSurveys, plans, bearing: outdoorBearing, keys, snapshots: catalog, maxDays: gap.valueAsNumber, basemap: chosenBasemap,
      sections, thresholdOverrides,
      showSites: $('show-sites').checked, siteStyle: siteStyle(), matchPci: $('site-pci-colors').checked,
      thresholds: $('map-legend').checked, request: gisRequest,
      progress: (current, total, title) => {
        captureShare = 70;
        reportProgress.value = captureShare * (current - 1) / total;
        reportStatus.textContent = `Capturing map ${current} of ${total}: ${title}…`;
      },
    });
    reportStatus.textContent = 'Assembling PowerPoint…';
    reportProgress.value = captureShare;
    const { buffer } = await workerRequest(new Worker(new URL('./report.worker.js', import.meta.url), { type: 'module' }),
      { location, maps, sections, surveys: selectedSurveys.map(({ filename, profile, days, metrics, sourceIndex }) => ({
        filename, profile, days, sourceIndex, metrics: metrics.filter(metric => keys.includes(metric.key))
          .map(({ key, series, histogram, statistics }) => ({ key, series, histogram, statistics })),
      })), keys }, ({ completed, total }) => {
        reportProgress.value = captureShare + (95 - captureShare) * completed / total;
        if (completed === total) reportStatus.textContent = 'Packaging PowerPoint…';
      });
    download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }),
      `${filename(location)}-report.pptx`);
    const missing = maps.filter(map => map.missingBasemap).length;
    reportStatus.textContent = 'PowerPoint download started.' + (missing
      ? ` Basemap unavailable on ${missing} ${missing === 1 ? 'slide' : 'slides'}; the survey points are included.` : '');
  } catch (error) {
    reportStatus.textContent = `PowerPoint export failed: ${error.message}`;
  } finally {
    reportProgress.hidden = true;
    reporting = false;
    controls();
  }
});

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installEvent = event;
  $('install').hidden = false;
});
$('install').addEventListener('click', async () => {
  const event = installEvent;
  if (!event) return;
  installEvent = undefined;
  $('install').hidden = true;
  try {
    await event.prompt();
  } catch (error) {
    sourceStatus('status', `Install prompt failed: ${error.message}`, true);
  }
});
window.addEventListener('appinstalled', () => { $('install').hidden = true; });

const workspaceDialog = $('workspace-dialog');
const workspaceValues = ['image-format', 'snapshot-date', 'snapshot-gap', ...siteSliders];
const workspaceChecks = ['map-legend', 'show-sites', 'show-hover-links', 'site-pci-colors', 'site-detected-only'];
const readControls = (ids, property) => Object.fromEntries(ids.map(id => [id, $(id)[property]]));
function currentWorkspace() {
  return workspaceSnapshot({ surveys, snapshots, plans }, {
    location: $('location').value, metric: $('metric').value, mode: $('mode').value,
    group: Math.max(0, $('workbook-group').selectedIndex), basemap: chosenBasemap, outdoorBearing,
    theme: document.documentElement.dataset.theme,
    ...(selectedWorkbooks && { workbookSelection: surveys.flatMap((survey, index) => selectedWorkbooks.has(survey) ? [index] : []) }),
    values: readControls(workspaceValues, 'value'), checks: readControls(workspaceChecks, 'checked'),
  });
}

async function restoreWorkspace({ imports, view }) {
  clearTimeout(planSaveTimer);
  resetMap();
  active = undefined;
  mapPlan = undefined;
  ({ surveys, snapshots, plans } = imports);
  selectedWorkbooks = view.workbookSelection && view.workbookSelection.length < surveys.length
    ? new Set(view.workbookSelection.map(index => surveys[index])) : null;
  $('location').value = view.location;
  chosenBasemap = [...$('basemap').options].some(option => option.value === view.basemap && !option.disabled)
    ? view.basemap : 'local';
  outdoorBearing = normalDegrees(view.outdoorBearing);
  themePreference = view.theme;
  applyTheme();
  for (const id of workspaceValues) $(id).value = view.values[id] ?? $(id).defaultValue;
  stopGapAnimation();
  previousGap = snapshotGap.valueAsNumber;
  for (const id of workspaceChecks) $(id).checked = view.checks[id] ?? $(id).defaultChecked;
  for (const id of siteSliders) $(id).dispatchEvent(new Event('input'));
  mapView?.setHoverLinks($('show-hover-links').checked);
  list($('issues'), []);
  $('issues').hidden = true;
  renderCatalogs();
  renderPlans();
  renderSurvey(false, true, view);
  sourceStatus('status', `Restored ${surveys.length} workbooks. ${keys.length} KPIs available.`);
  $('catalog-status').textContent = `Restored ${snapshots.length} dated snapshots.`;
  sourceStatus('plan-status', `Restored ${plans.length} floor ${plans.length === 1 ? 'plan' : 'plans'}.`);
  if ($('keep-imports').checked) await persistImports();
}

const workspaceActions = ['workspace-save', 'workspace-download', 'workspace-restore', 'workspace-open'];
let workspaceBusy = false;
function workspaceAction(id, action) {
  const status = $(`${id}-status`);
  $(id).addEventListener('click', async () => {
    workspaceBusy = true;
    for (const control of [...workspaceActions, 'workspace-file', 'workspace-close']) $(control).disabled = true;
    status.textContent = 'Working…';
    try {
      status.textContent = await action();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      workspaceBusy = false;
      for (const control of [...workspaceActions, 'workspace-file', 'workspace-close']) $(control).disabled = false;
      $('workspace-open').disabled = !$('workspace-file').files.length;
    }
  });
}
$('workspace').addEventListener('click', () => {
  $('workspace-file').value = '';
  $('workspace-open').disabled = true;
  for (const id of workspaceActions) $(`${id}-status`).textContent = '';
  workspaceDialog.showModal();
});
workspaceDialog.addEventListener('cancel', event => { if (workspaceBusy) event.preventDefault(); });
$('workspace-file').addEventListener('change', () => {
  $('workspace-open').disabled = !$('workspace-file').files.length;
  $('workspace-open-status').textContent = '';
});
workspaceAction('workspace-save', async () => {
  await saveWorkspace(currentWorkspace());
  return 'Workspace saved in this browser.';
});
workspaceAction('workspace-download', () => {
  const workspace = currentWorkspace();
  download(new Blob([JSON.stringify(workspace)], { type: 'application/json' }),
    `${filename(workspace.view.location || 'surveyor')}.surveyor.json`);
  return 'Workspace download started.';
});
workspaceAction('workspace-restore', async () => {
  const saved = await loadWorkspace();
  if (!saved) throw new Error('No workspace has been saved in this browser yet.');
  await restoreWorkspace(validateWorkspace(saved));
  return 'Workspace restored from this browser.';
});
workspaceAction('workspace-open', async () => {
  const file = $('workspace-file').files[0];
  await restoreWorkspace(parseWorkspace(await file.text()));
  $('workspace-file').value = '';
  return 'Workspace restored from file.';
});

$('keep-imports').addEventListener('change', persistImports);
async function restoreImports() {
  controls();
  $('catalogs').disabled = true;
  $('plans').disabled = true;
  try {
    const saved = await loadImports();
    $('keep-imports').checked = Boolean(saved);
    if (saved) {
      ({ surveys, snapshots, plans = [] } = saved);
      if (!saved.workbookOrderSaved) surveys = orderWorkbookBatch(surveys);
      renderCatalogs();
      renderPlans();
      renderSurvey();
      if (surveys.length) sourceStatus('status', `Restored ${surveys.length} workbooks. ${keys.length} KPIs available.`);
      if (snapshots.length) $('catalog-status').textContent = `Restored ${snapshots.length} dated snapshots.`;
      if (plans.length) sourceStatus('plan-status', `Restored ${plans.length} floor ${plans.length === 1 ? 'plan' : 'plans'}.`);
      storageStatus('Imports saved locally in this browser.');
      if (!saved.workbookOrderSaved) await persistImports();
    }
    $('keep-imports').disabled = false;
  } catch (error) {
    storageStatus(`Could not restore saved imports: ${error.message}`);
  } finally {
    restoring = false;
    $('catalogs').disabled = false;
    $('plans').disabled = false;
    controls();
  }
}
void restoreImports();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(error => {
    sourceStatus('status', `Offline setup failed: ${error.message}`, true);
  });
}

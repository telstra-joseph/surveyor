import './style.css';
import { binsPerPage, chart, datasets, deviceName, escapeMarkup, format, groupDatasets, legend, legendImage, markLimit, metricName, modes, sourceTable, technologyModeKey, toSvg } from './charts.js';
import { importFiles, workerRequest } from './workers.js';
import { cellDescription, createMapView } from './map-view.js';
import { supportsMapThresholds } from './map-thresholds.js';
import { sectorLegendGroups } from './sector-style.js';
import { mapImage, stackImages, svgImage } from './image-export.js';
import { loadImports, saveImports } from './saved-imports.js';

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
let keys = [];
let page = 0;
let importing = false;
let restoring = true;
let reporting = false;
let active;
let installEvent;
let snapshots = [];
let mapView;
let mapSequence = 0;
const gisRequest = data => workerRequest(new Worker(new URL('./gis.worker.js', import.meta.url), { type: 'module' }), data);

function storageStatus(message) {
  $('storage-status').hidden = !message;
  $('storage-status').textContent = message;
}

async function persistImports() {
  try {
    const keep = $('keep-imports').checked;
    await saveImports(keep ? { surveys, snapshots } : null);
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

function renderLegend(title, entries) {
  active.legend = { title, entries };
  $('legend-title').textContent = title;
  renderSwatches($('legend'), entries);
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

function sectorLegend() {
  if (!$('show-sites').checked || active?.mode !== 'map') return [];
  return sectorLegendGroups(active.map?.sectors || []);
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
  $('report').disabled = importing || reporting || !surveys.length;
  $('clear').disabled = importing || reporting || !surveys.length;
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
const table = (caption, headers, rows) =>
  `<table><caption>${escapeMarkup(caption)}</caption><thead><tr>${headers.map(header => `<th scope="col">${cell(header)}</th>`).join('')}</tr></thead>
   <tbody>${rows.map(([label, ...values]) => `<tr><th scope="row">${cell(label)}</th>${values.map(value => `<td>${cell(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

function renderTable() {
  if (!active || !$('data-details').open) return;
  const { mode, title, items, rows } = active;
  const mapRows = mode === 'map' ? active.map?.samples.features.slice(page * 100, (page + 1) * 100) || [] : [];
  $('table').innerHTML = mode === 'map'
    ? table(`${title}: geolocated samples on this page`, ['Device', 'Log row', 'Longitude', 'Latitude', 'Value', 'Network', 'LTE association', 'NR association', 'Site link'],
      mapRows.map(({ geometry, properties: props }) => [
        props.DEVICE, props.LOG_ROW, ...geometry.coordinates.map(String), props.CATEGORY || props.VALUE, props.NETWORK,
        cellDescription(props, 'L') || null, cellDescription(props, 'N') || null, '—',
      ]))
    : mode === 'series'
    ? table(`${title}: source samples on this page`, ['Device', 'Workbook row position', 'Value'], rows)
    : table(title, [mode === 'histogram' ? 'Range or category' : 'Statistic', ...items.map(item => `${item.tag} ${item.name}`)],
      rows.map(({ label, values }) => [label, ...values]));
  if (mode === 'map') $('table').querySelectorAll('tbody tr').forEach((row, index) => {
    const sample = mapRows[index];
    if (!sample.siteLinks) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Show on map';
    button.setAttribute('aria-label', `Show ${sample.properties.DEVICE} row ${sample.properties.LOG_ROW} on map`);
    button.addEventListener('click', () => {
      $('show-sites').checked = true;
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
  const allItems = datasets(surveys, key, mode);
  if (!allItems.length) return;
  const groups = groupDatasets(allItems);
  const group = $('workbook-group').selectedIndex;
  const items = groups[group];
  const groupSuffix = groups.length > 1 ? `-group-${group + 1}` : '';
  const isMap = mode === 'map';
  const fullRows = mode === 'series' || isMap ? [] : sourceTable(items);
  const perPage = mode === 'series' ? 100 : binsPerPage;
  const total = isMap ? 1 : mode === 'series' ? items.reduce((count, item) => count + item.data.length, 0) : fullRows.length;
  const pages = Math.ceil(total / perPage);
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
  active = { key, title, mode, items, rows, plot, pages, groupSuffix };
  $('chart-title').textContent = `${title} — ${modes[mode]}`;
  const missing = surveys.length - allItems.length;
  const interpretation = mode === 'histogram'
    ? 'Counts and ranges come from the workbooks. An omitted bin is not a reported zero.'
    : mode === 'series'
      ? `Workbook row positions are not time-aligned. For dense traces, the plot keeps up to ${markLimit} points per device; the source table retains every numeric reading.`
      : isMap ? '' : 'Statistics are displayed as reported, not recalculated across devices.';
  const availability = missing ? `${missing} of ${surveys.length} workbooks did not report this view.` : '';
  $('interpretation').textContent = [interpretation, availability].filter(Boolean).join(' ');
  $('interpretation').hidden = !interpretation && !availability;
  $('visual').hidden = !plot;
  $('visual').innerHTML = plot ? toSvg(plot) : '';
  for (const id of ['export-chart', 'copy-plot', 'export-both']) $(id).hidden = !plot && !isMap;
  if (!isMap) setMapImageActions(false);
  updateImageLabels();
  if (isMap && key === technologyModeKey) renderLegend('Technology mode legend', []);
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
  $('pagination').hidden = pages <= 1;
  $('previous').setAttribute('aria-disabled', String(page === 0));
  $('next').setAttribute('aria-disabled', String(page >= pages - 1));
  $('page').textContent = `${mode === 'series' || mode === 'map' ? 'Source values' : 'Page'} ${page + 1} of ${pages}`;
}

function resetMap() {
  mapSequence++;
  mapView?.setBasemap('local');
  mapView?.clear();
}

function setMapActions(disabled) {
  for (const id of ['fit-map', 'download-kml', 'download-shp', 'basemap']) $(id).disabled = disabled;
  setMapImageActions(disabled);
}

function setMapImageActions(disabled) {
  for (const id of ['export-chart', 'copy-plot', 'export-legend', 'export-both']) $(id).disabled = disabled;
}

async function renderMap(preserveSelection = false) {
  const request = ++mapSequence;
  page = 0;
  delete active.map;
  renderSectorLegend();
  active.pages = 1;
  renderPagination();
  renderTable();
  setMapActions(true);
  $('map-scale').hidden = true;
  const canChooseLegend = surveys.length > 1 && supportsMapThresholds(active.key);
  $('map-legend-field').hidden = !canChooseLegend;
  const legendMode = canChooseLegend ? ($('map-legend').checked ? 'thresholds' : 'ue') : 'auto';
  mapView ||= createMapView($('survey-map'), $('basemap'), message => { $('map-status').textContent = message; });
  if (!preserveSelection || !mapView.selectedDevice()) {
    mapView.setBasemap('local');
    mapView.clear();
  }
  $('map-status').textContent = 'Preparing map…';
  const gap = $('snapshot-gap');
  if (!gap.validity.valid) {
    $('map-status').textContent = 'Enter a whole number of days (0 or more) for the snapshot gap.';
    return;
  }
  try {
    const { map } = await gisRequest({ type: 'map', key: active.key, snapshots, maxDays: gap.valueAsNumber, legendMode,
      workbooks: active.items.map(({ index, tag, color }) => {
        const { filename, geography, metrics, network } = surveys[index];
        const metric = metrics.find(item => item.key === active.key);
        const { key, series, geoCategories } = metric;
        return { survey: { filename, geography, network, metrics: [{ key, series, geoCategories }] }, tag, color };
      }) });
    if (request !== mapSequence) return;
    active.map = map;
    renderSectorLegend();
    if (active.key === technologyModeKey) renderLegend('Technology mode legend', map.technologyLegend);
    else if (map.thresholdLegend.length) renderLegend('KPI thresholds', map.thresholdLegend);
    else renderLegend(map.ueColors ? 'UE legend' : 'Legend', active.items.map(({ tag, name, color }) => ({ label: `${tag} ${name}`, color })));
    active.pages = Math.max(1, Math.ceil(map.samples.features.length / 100));
    const { plotted, sitesPlotted } = mapView.render(map, $('show-sites').checked, preserveSelection);
    const count = map.samples.features.length, siteCount = map.sites.features.length;
    mapView.setBasemap(count ? $('basemap').value : 'local');
    if (map.thresholdLegend.length) {
      $('map-scale').hidden = false;
      $('map-scale').textContent = 'Point colours indicate KPI threshold bands.';
    } else if (map.ueColors) {
      $('map-scale').hidden = false;
      $('map-scale').textContent = 'Point colours identify the UE, not the KPI value.';
    } else {
      $('map-scale').hidden = true;
      $('map-scale').textContent = '';
    }
    $('map-status').textContent = `${format(count)} geolocated ${count === 1 ? 'sample' : 'samples'} · ${format(siteCount)} associated Actix ${siteCount === 1 ? 'cell' : 'cells'}.`
      + (plotted < count || sitesPlotted < siteCount ? ` Map preview shows ${format(plotted)} samples and ${format(sitesPlotted)} cells; downloads include all points.` : '');
    setMapActions(!count);
    renderPagination();
    renderTable();
  } catch (error) {
    if (request === mapSequence) $('map-status').textContent = `Map could not be prepared: ${error.message}`;
  }
}

function renderGroups(preserveSelection = false) {
  const groups = groupDatasets(datasets(surveys, $('metric').value, $('mode').value));
  const select = $('workbook-group');
  select.replaceChildren();
  for (const items of groups) {
    const first = items[0].tag;
    const last = items.at(-1).tag;
    select.add(new Option(first === last ? first : `${first}–${last}`));
  }
  $('workbook-groups').hidden = groups.length <= 1;
  if (preserveSelection) {
    const device = mapView?.selectedDevice();
    const index = groups.findIndex(items => items.some(item => item.tag === device));
    if (index >= 0) select.selectedIndex = index;
  }
  page = 0;
  renderChart(preserveSelection);
}

function renderModes(preferred, preserveSelection = false) {
  const available = Object.keys(modes).filter(mode => datasets(surveys, $('metric').value, mode).length);
  $('mode').replaceChildren(...available.map(mode => new Option(modes[mode], mode)));
  if (available.includes(preferred)) $('mode').value = preferred;
  renderGroups(preserveSelection && $('mode').value === 'map');
}

function renderSurvey() {
  const previous = $('metric').value;
  keys = [...new Set(surveys.flatMap(survey => survey.metrics.map(metric => metric.key)))];
  $('empty').hidden = keys.length > 0;
  $('explorer').hidden = !keys.length;
  $('sources').hidden = !surveys.length;
  list($('source-list'), surveys.map((survey, index) =>
    `S${index + 1} ${deviceName(survey)} · ${survey.filename} · ${format(survey.rows)} series rows`));
  $('metric').replaceChildren(...keys.map(key => new Option(metricName(key), key)));
  if (keys.includes(previous)) $('metric').value = previous;
  else if (keys.includes('LTE_UE_RSRP')) $('metric').value = 'LTE_UE_RSRP';
  if (keys.length) renderModes($('mode').value);
  else {
    resetMap();
    active = undefined;
    $('table').replaceChildren();
    $('visual').replaceChildren();
    $('legend').replaceChildren();
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
  $('status').textContent = `Reading ${files.length} workbooks…`;
  try {
    const results = await importFiles(files, done => {
      $('status').textContent = `Read ${done} of ${files.length} workbooks.`;
    });
    const imported = results.flatMap(result => result.survey ? [result.survey] : []);
    const issues = results.flatMap(({ survey, filename, error }) => survey
      ? survey.warnings.map(warning => `${survey.filename}: ${warning}`)
      : [`${filename}: ${error}`]);
    list($('issues'), issues);
    $('issues').hidden = !issues.length;
    if (imported.length) {
      surveys = imported;
      renderSurvey();
      if ($('keep-imports').checked) await persistImports();
    }
    $('status').textContent = imported.length
      ? `Imported ${imported.length} of ${files.length} workbooks. ${keys.length} KPIs available.`
      : 'No workbooks could be imported. The current survey has not changed.';
  } catch (error) {
    $('status').textContent = `Import failed: ${error.message}`;
  } finally {
    importing = false;
    controls();
  }
});

$('clear').addEventListener('click', () => {
  surveys = [];
  $('location').value = '';
  $('issues').replaceChildren();
  $('issues').hidden = true;
  $('status').textContent = 'Survey cleared.';
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
$('previous').addEventListener('click', () => turnPage(-1));
$('next').addEventListener('click', () => turnPage(1));
$('data-details').addEventListener('toggle', renderTable);
function exportStatus(text) {
  $('export-status').hidden = false;
  $('export-status').textContent = text;
}
function updateImageLabels() {
  const name = $('image-format').value.toUpperCase();
  $('export-chart').textContent = `Download ${active?.mode === 'map' ? 'map image' : 'chart'} (${name})`;
  $('export-legend').textContent = `Download legend (${name})`;
  $('export-both').textContent = `Download both (${name})`;
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
      const key = asImage(active.mode === 'map' ? legendImage(active.legend.title, active.legend.entries) : legend(active.title, active.items));
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

$('basemap').addEventListener('change', event => mapView?.setBasemap(event.target.value));
$('map-legend').addEventListener('change', () => renderMap(true));
$('show-sites').addEventListener('change', event => {
  mapView?.setCells(event.target.checked);
  renderSectorLegend();
});
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

function renderCatalogs(messages = []) {
  list($('catalog-list'), [...snapshots.map(({ rat, day, filename, cells, skipped }) =>
    `${rat} · ${day} · ${filename} · ${format(cells.length)} cells${skipped ? ` (${format(skipped)} rows skipped)` : ''}`), ...messages]);
  $('catalog-list').hidden = !snapshots.length && !messages.length;
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
  const date = $('snapshot-date').value;
  const messages = [];
  let added = 0;
  for (const file of files) {
    $('catalog-status').textContent = `Reading ${file.name}…`;
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error('Select an Actix .csv file.');
      const { snapshot } = await gisRequest({ type: 'catalog', file, date });
      snapshots = snapshots.filter(item => item.rat !== snapshot.rat || item.day !== snapshot.day);
      snapshots.push(snapshot);
      added++;
    } catch (error) {
      messages.push(`${file.name}: ${error.message}`);
    }
  }
  input.disabled = false;
  $('catalog-status').textContent = `Read ${added} of ${files.length} files. ${snapshots.length} dated snapshots available.`;
  renderCatalogs(messages);
  if (added && $('keep-imports').checked) await persistImports();
});
$('clear-catalogs').addEventListener('click', () => {
  snapshots = [];
  $('catalog-status').textContent = 'Cell snapshots cleared.';
  renderCatalogs();
  if ($('keep-imports').checked) void persistImports();
});
$('snapshot-gap').addEventListener('change', () => { if (active?.mode === 'map') renderMap(); });

$('report').addEventListener('click', async () => {
  const location = $('location').value.trim() || 'Network survey';
  reporting = true;
  controls();
  $('status').textContent = 'Generating PowerPoint…';
  try {
    const { buffer } = await workerRequest(new Worker(new URL('./report.worker.js', import.meta.url), { type: 'module' }),
      { location, surveys: surveys.map(({ filename, profile, metrics }) => ({
        filename, profile, metrics: metrics.map(({ key, series, histogram, statistics }) => ({ key, series, histogram, statistics })),
      })), keys });
    download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }),
      `${filename(location)}-report.pptx`);
    $('status').textContent = 'PowerPoint download started.';
  } catch (error) {
    $('status').textContent = `PowerPoint export failed: ${error.message}`;
  } finally {
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
    $('status').textContent = `Install prompt failed: ${error.message}`;
  }
});
window.addEventListener('appinstalled', () => { $('install').hidden = true; });

$('keep-imports').addEventListener('change', persistImports);
async function restoreImports() {
  controls();
  $('catalogs').disabled = true;
  try {
    const saved = await loadImports();
    $('keep-imports').checked = Boolean(saved);
    if (saved) {
      ({ surveys, snapshots } = saved);
      renderCatalogs();
      renderSurvey();
      if (surveys.length) $('status').textContent = `Restored ${surveys.length} workbooks. ${keys.length} KPIs available.`;
      if (snapshots.length) $('catalog-status').textContent = `Restored ${snapshots.length} dated snapshots.`;
      storageStatus('Imports saved locally in this browser.');
    }
    $('keep-imports').disabled = false;
  } catch (error) {
    storageStatus(`Could not restore saved imports: ${error.message}`);
  } finally {
    restoring = false;
    $('catalogs').disabled = false;
    controls();
  }
}
void restoreImports();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(error => {
    $('status').textContent = `Offline setup failed: ${error.message}`;
  });
}

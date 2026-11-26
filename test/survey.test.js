import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { binsPerPage, callDropKey, chart, datasets, groupDatasets, legend, samplePoints, sourceTable, toSvg } from '../src/charts.js';
import { makeReport } from '../src/report.js';
import { mapImage, stackImages } from '../src/image-export.js';
import { parseWorkbook } from '../src/survey.js';
import { orderWorkbookBatch } from '../src/workers.js';
import { applySavedKpiOrder, defaultReportKpiOrder, groupReportFloors } from '../src/report-options.js';
import { parseWorkspace, workspaceSnapshot } from '../src/workspace.js';

test('portable workspaces preserve workbook order, floor assignments, snapshots and view settings', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Series Formatted Data').addRows([
    ['Longitude', 'Latitude', 'LTE_UE_RSRP'], [151, -32, -100],
  ]);
  const buffer = await workbook.xlsx.writeBuffer();
  const first = await parseWorkbook(buffer, 'UE2.xlsx');
  const second = await parseWorkbook(buffer, 'UE1.xlsx');
  const plan = {
    id: 'plan', name: 'Floor', image: 'data:image/png;base64,AA==', width: 120, height: 60,
    planar: true, corners: [[0, 0], [120, 0], [0, -60]], markers: [[1, -1]], bearing: 90,
  };
  const snapshot = { rat: 'LTE', day: '2026-11-04', filename: 'test.csv',
    cells: [{ coords: [151, -32], site: 'A', name: 'Test', sector: '', angles: null }] };
  const saved = workspaceSnapshot({ surveys: [{ ...first, planId: plan.id }, second], plans: [plan], snapshots: [snapshot] }, {
    location: 'Test site', metric: 'LTE_UE_RSRP', mode: 'map', basemap: 'local', group: 1,
    theme: 'dark', outdoorBearing: 12, values: { 'image-format': 'png' }, checks: { 'show-sites': false },
  });
  assert.deepEqual(parseWorkspace(JSON.stringify(saved)), saved);
  assert.throws(() => parseWorkspace(JSON.stringify({ ...saved, version: 2 })), /version is not supported/);
  assert.throws(() => parseWorkspace(JSON.stringify({
    ...saved, imports: { ...saved.imports, plans: [{ ...plan, image: 'https://example.com/plan.png' }] },
  })), /invalid floor plans/);
  assert.throws(() => parseWorkspace('{ broken'), /not valid JSON/);
});

test('call drop sample plots and PowerPoint fallback show only detected events', async () => {
  const metric = { key: callDropKey, series: [[1, 0], [2, 1], [3, 2]], histogram: [['No drop', 1], ['Drop', 1]] };
  const noDrops = { ...metric, series: [[1, 0]] };
  const surveys = [{ filename: 'UE1.xlsx', metrics: [metric] }, { filename: 'UE2.xlsx', metrics: [noDrops] }];
  const items = datasets(surveys, callDropKey, 'series');
  assert.deepEqual(items.map(({ data }) => data), [[[2, 1]], []]);
  assert.equal(chart('Call drops', 'series', items).marks.filter(({ kind }) => kind === 'dot').length, 1);
  assert.doesNotMatch(toSvg(chart('Call drops', 'series', items.slice(1))), /NaN|Infinity|<circle/);
  const zip = await JSZip.loadAsync(await makeReport({ location: 'Test site', surveys, keys: [callDropKey] }));
  const slide = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(slide, /Recorded samples/);
  assert.equal([...slide.matchAll(/>Drop detected</g)].length, 1);
  assert.doesNotMatch(slide, /UE2|>No drop</);
  const noDropSlide = await zip.file('ppt/slides/slide3.xml').async('string');
  assert.match(noDropSlide, /No call drops detected/);
  assert.doesNotMatch(noDropSlide, />Drop detected</);
});

test('groups selected workbooks by plan ID, including a section for unassigned logs', () => {
  const surveys = [{ planId: 'A', planName: 'Level' }, {}, { planId: 'B', planName: 'Level' },
    { planId: 'A', planName: 'Level' }, { planId: 'C', planName: 'Excluded' }];
  assert.deepEqual([...groupReportFloors(surveys, [2, 0, 1, 3]).values()], [
    { id: 'B', title: 'Level', workbookIndexes: [2] },
    { id: 'A', title: 'Level', workbookIndexes: [0, 3] },
    { id: null, title: 'No floor plan', workbookIndexes: [1] },
  ]);
});

test('restores saved KPI positions and adds newly available KPIs in their default order', () => {
  assert.deepEqual(applySavedKpiOrder(
    ['Technology_Mode', 'NR_UE_PCI_0', 'LTE_UE_RSRP', 'NR_UE_SINR_0', 'LTE_UE_PCI'],
    ['LTE_UE_PCI', 'missing', 'Technology_Mode', 'LTE_UE_PCI'],
  ), ['LTE_UE_PCI', 'Technology_Mode', 'NR_UE_PCI_0', 'NR_UE_SINR_0', 'LTE_UE_RSRP']);
});

test('groups NR KPIs at the first NR entry while preserving order within both groups', () => {
  assert.deepEqual(defaultReportKpiOrder(['Technology_Mode', 'NR_UE_PCI_0', 'LTE_UE_RSRP', '5G NR SS-SINR', 'App_Throughput_DL']), [
    'Technology_Mode', 'NR_UE_PCI_0', '5G NR SS-SINR', 'LTE_UE_RSRP', 'App_Throughput_DL',
  ]);
});

test('orders a batch numerically by workbook UE, preserving ties and placing unidentified logs last', () => {
  const unnamed = { filename: 'queue1.xlsx' };
  const ue10 = { filename: 'Location - UE10.xlsx' };
  const ue4 = { filename: 'test.xlsx', profile: 'UE4 S26U' };
  const ue1 = { filename: 'Location - UE1.xlsx' };
  const ue4b = { filename: 'Location - UE3.xlsx', profile: 'UE4 S26U' };
  assert.deepEqual(orderWorkbookBatch([unnamed, ue10, ue4, ue1, ue4b]), [ue1, ue4, ue4b, ue10, unnamed]);
});

test('map image exports scaled Actix symbols and faded labels without fading survey points', t => {
  class SymbolSvg {
    getBoundingClientRect() { return { left: 20, top: 30, width: 22, height: 22 }; }
    cloneNode() { return { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }; }
  }
  class SampleCanvas {
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    toDataURL() { return 'data:image/png;base64,points'; }
  }
  const browserGlobals = {
    SVGSVGElement: SymbolSvg, HTMLCanvasElement: SampleCanvas,
    getComputedStyle: node => ({ opacity: '0.4', visibility: node.visibility || 'visible' }),
    XMLSerializer: class { serializeToString({ attributes: { width, height } }) {
      return `<svg viewBox="0 0 11 11" width="${width}" height="${height}"/>`;
    } },
  };
  Object.assign(globalThis, browserGlobals);
  t.after(() => { for (const key of Object.keys(browserGlobals)) delete globalThis[key]; });
  const labels = [
    { textContent: 'TEST', getBoundingClientRect: () => ({ left: 45, top: 30, width: 25, height: 14 }) },
    { textContent: 'BLOCKED', visibility: 'hidden', getBoundingClientRect: () => ({ left: 45, top: 50, width: 25, height: 14 }) },
  ];
  const layers = {
    '.leaflet-overlay-pane :is(canvas, svg)': [new SampleCanvas()],
    '.actix-site-centre svg, .actix-site-label span': [new SymbolSvg(), ...labels],
  };
  const { svg } = mapImage({
    clientWidth: 100, clientHeight: 100, clientLeft: 0, clientTop: 0, dataset: {}, classList: { contains: () => false },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    querySelector: () => null,
    querySelectorAll: selector => layers[selector] || [],
  }, 'Test map');
  assert.match(svg, /viewBox="0 0 100 100"/);
  assert.match(svg, /translate\(20 30\)" opacity="0.4"><svg viewBox="0 0 11 11" width="22" height="22"/);
  assert.match(svg, /<g opacity="0.4"><rect x="45".*TEST<\/text><\/g>/);
  assert.doesNotMatch(svg, /BLOCKED/);
  assert.match(svg, /<image x="0" y="0" width="100" height="100" href="data:image\/png;base64,points"\/>/);
  const cropped = mapImage({
    clientWidth: 100, clientHeight: 100, clientLeft: 0, clientTop: 0, dataset: {}, classList: { contains: () => true },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    querySelector: () => ({
      naturalWidth: 200, naturalHeight: 100,
      getBoundingClientRect: () => ({ left: 21.5, top: 12.75, width: 30.25, height: 56.5 }),
    }),
    querySelectorAll: selector => layers[selector] || [],
  }, 'Indoor map');
  assert.deepEqual([cropped.width, cropped.height], [129, 64.5]);
  assert.match(cropped.svg, /<g transform="translate\(27\.875 -8\.75\)".*data:image\/png;base64,points/);
});

test('PowerPoint uses a map or chart independently for each UE and KPI', async () => {
  const deck = await makeReport({
    location: 'Test site', keys: ['LTE_UE_RSRP', 'LTE_UE_SINR'],
    surveys: [{ filename: 'test.xlsx', days: ['2026-10-14', '2026-10-13'], metrics: [
      { key: 'LTE_UE_RSRP', histogram: [['RSRP distribution', 5]] },
      { key: 'LTE_UE_SINR', histogram: [['SINR distribution', 3]] },
    ] }, { filename: 'UE2.xlsx', metrics: [{ key: 'LTE_UE_RSRP', series: [[1, -90]] }] }],
    maps: [{
      key: 'LTE_UE_RSRP', workbookIndex: 0, width: 1100, height: 530,
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFPsAAAAASUVORK5CYII=',
      legend: { title: 'KPI thresholds', entries: [{ label: 'Good coverage', color: '#0D54FF' }] },
      sectors: [{ rat: 'LTE', entries: [{ label: 'F 700 MHz', color: '#00FFFF' }] }],
      attribution: 'Test basemap contributors',
    }],
  });
  const zip = await JSZip.loadAsync(deck);
  const cover = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(cover, /13.*14 Oct 2026/);
  assert.doesNotMatch(cover, /workbooks|KPIs/);
  const map = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(map, /<p:pic>/);
  for (const text of ['KPI thresholds', 'Good coverage', 'Test basemap contributors']) {
    assert.ok(map.includes(text), text);
  }
  assert.doesNotMatch(map, /Map plot|RSRP distribution|LTE sectors|F 700 MHz/i);
  assert.match(map, /S1 test/);
  assert.doesNotMatch(map, /S2 UE2/);
  const chartSlide = await zip.file('ppt/slides/slide3.xml').async('string');
  assert.match(chartSlide, /Recorded samples \| S2 UE2/);
  assert.doesNotMatch(chartSlide, /<p:pic>/);
  assert.match(await zip.file('ppt/slides/slide4.xml').async('string'), /SINR distribution/);
});

test('PowerPoint keeps UE slides separate within the requested floor sections', async () => {
  const surveys = ['second & co.xlsx', 'first.xlsx', 'third.xlsx'].map((filename, i) => ({
    filename, profile: `Device ${i}`, sourceIndex: i, days: [`2026-10-1${i + 3}`], metrics: [
      { key: 'LTE_UE_SINR', series: [[0, i]] },
      { key: 'LTE_UE_RSRP', series: [[0, i - 100]] },
    ],
  }));
  const zip = await JSZip.loadAsync(await makeReport({
    location: 'Test site', keys: ['LTE_UE_SINR'], surveys,
    sections: [{ title: 'Upper & east', workbookIndexes: [1] }, { title: 'Lower', workbookIndexes: [0, 2] }],
  }));
  const read = name => zip.file(`ppt/${name}.xml`).async('string');
  const deck = await read('presentation');
  assert.deepEqual([...deck.matchAll(/<p14:section name="([^"]+)"[^>]*><p14:sldIdLst>(.*?)<\/p14:sldIdLst>/g)]
    .map(([, name, slides]) => [name, [...slides.matchAll(/id="(\d+)"/g)].map(match => match[1])]),
  [['Title', ['256']], ['Upper &amp; east', ['257']], ['Lower', ['258', '259']]]);
  assert.match(await read('slides/slide2'), /SINR.*Upper &amp; east/s);
  assert.match(await read('slides/slide3'), /SINR.*Lower/s);
  assert.match(await read('slides/slide2'), /<a:t>S2<\/a:t>/);
  assert.match(await read('slides/slide3'), /<a:t>S1<\/a:t>/);
  assert.doesNotMatch(await read('slides/slide3'), /<a:t>S3<\/a:t>/);
  assert.match(await read('slides/slide4'), /<a:t>S3<\/a:t>/);
  assert.equal(zip.file('ppt/slides/slide5.xml'), null);
});

test('PowerPoint keeps custom floor dividers and KPI slides in distinct sections with the same name', async () => {
  const key = 'LTE_UE_SINR';
  const zip = await JSZip.loadAsync(await makeReport({
    location: 'Test site', keys: [key],
    surveys: ['second.xlsx', 'first.xlsx'].map(filename => ({ filename, metrics: [{ key, series: [[0, 1]] }] })),
    sections: [{ title: 'Level 1', workbookIndexes: [0], dividerTitle: 'Lobby & entrance' },
      { title: 'Level 1', workbookIndexes: [1], dividerTitle: 'Upper floor' }],
  }));
  const slide = n => zip.file(`ppt/slides/slide${n}.xml`).async('string');
  assert.match(await slide(2), /<a:t>Lobby &amp; entrance<\/a:t>/);
  assert.match(await slide(3), /SINR.*Level 1.*Page 3/s);
  assert.match(await slide(4), /<a:t>Upper floor<\/a:t>/);
  assert.match(await slide(5), /SINR.*Level 1.*Page 5/s);
  const deck = await zip.file('ppt/presentation.xml').async('string');
  assert.match(deck, /name="Level 1"[^>]*><p14:sldIdLst><p14:sldId id="257"\/><p14:sldId id="258"\/>/);
  assert.match(deck, /name="Level 1"[^>]*><p14:sldIdLst><p14:sldId id="259"\/><p14:sldId id="260"\/>/);
  assert.equal(zip.file('ppt/slides/slide6.xml'), null);
});

test('PowerPoint centres a tightly cropped floor plan in the map area without online basemap text', async () => {
  const key = 'LTE_UE_RSRP';
  const zip = await JSZip.loadAsync(await makeReport({
    location: 'Test site', keys: [key], surveys: [{ filename: 'UE1.xlsx', days: ['2026-10-13'], metrics: [] }],
    maps: [{
      key, workbookIndex: 0, plan: 'Level 2', width: 400, height: 600,
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFPsAAAAASUVORK5CYII=',
      legend: { title: 'KPI thresholds', entries: [] }, attribution: 'OpenStreetMap contributors',
    }],
  }));
  assert.match(await zip.file('ppt/slides/slide1.xml').async('string'), /<a:t>13 Oct 2026<\/a:t>/);
  const slide = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(slide, /Floor plan: Level 2/);
  assert.doesNotMatch(slide, /OpenStreetMap|Map plot/i);
  const picture = slide.match(/<p:pic>.*?<\/p:pic>/s)[0];
  const [, left, top, width, height] = picture.match(/<a:off x="(\d+)" y="(\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/).map(Number);
  const inches = 914400;
  assert.ok(Math.abs((left + width / 2) / inches - 5.29) < .001);
  assert.ok(Math.abs(top / inches - 1.48) < .001);
  assert.ok(Math.abs((top + height) / inches - 6.84) < .001);
});

test('PowerPoint map legends show matched PCI names and downlink frequencies', async () => {
  const entry = (value, cells) => ({ value, label: String(value), color: '#0D54FF', cells });
  const cases = [
    ['Technology_Mode', [entry('LTE')], ['Legend', 'LTE']],
    ['LTE_UE_PCI', [entry(172, [{ name: 'SITEBM4', exact: true }]), entry(173)], ['Legend', '172 — SITEBM4', '173']],
    ['NR_UE_PCI_0', [entry(85, [{ name: 'SITEVM1', exact: false }])], ['Legend', '85 — SITEVM1 (candidate)']],
    ['LTE_UE_EARFCN_DL', [entry(1725), entry(9410), entry(5000)],
      ['LTE EARFCN', 'Channel number', '1725 — 1857.5 MHz', '9410 — 778 MHz', '5000 — frequency unavailable']],
    ['NR_UE_NR_ARFCN_DL_0', [entry(173000), entry(650000), entry(2016667)],
      ['NR-ARFCN', 'Channel number', '173000 — 865 MHz', '650000 — 3750 MHz', '2016667 — 24250.08 MHz']],
  ];
  const deck = await makeReport({
    location: 'Test site', keys: cases.map(([key]) => key), surveys: [{ filename: 'UE1.xlsx', metrics: [] }],
    maps: cases.map(([key, entries]) => ({
      key, workbookIndex: 0, width: 1100, height: 530,
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFPsAAAAASUVORK5CYII=',
      legend: { title: key === 'Technology_Mode' ? 'Technology mode legend' : 'Original heading', entries },
    })),
  });
  const zip = await JSZip.loadAsync(deck);
  for (const [index, [, , expected]] of cases.entries()) {
    const slide = await zip.file(`ppt/slides/slide${index + 2}.xml`).async('string');
    for (const text of expected) assert.ok(slide.includes(`<a:t>${text}</a:t>`), text);
    assert.doesNotMatch(slide, /Original heading|Technology mode legend|downlink (?:EARFCN|ARFCN)/);
  }
});

test('PowerPoint map legends preserve SINR counts, colours and circular swatches', async () => {
  const entries = [
    { label: 'Below -5.00 (1) 20%', color: '#FF0000', shape: 'circle' },
    { label: '≥ -5.00 to < 0.00 (1) 20%', color: '#FFA600', shape: 'circle' },
    { label: '≥ 0.00 to < 5.00 (1) 20%', color: '#FFFF00', shape: 'circle' },
    { label: '≥ 5.00 to < 10.00 (1) 20%', color: '#00FF00', shape: 'circle' },
    { label: '≥ 10.00 (1) 20%', color: '#008000', shape: 'circle' },
  ];
  const deck = await makeReport({
    location: 'Test site', keys: ['LTE_UE_SINR'], surveys: [{ filename: 'UE1.xlsx', metrics: [] }],
    maps: [{
      key: 'LTE_UE_SINR', workbookIndex: 0, width: 1100, height: 530,
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFPsAAAAASUVORK5CYII=',
      legend: { title: 'KPI thresholds', entries }, sectors: [],
    }],
  });
  const zip = await JSZip.loadAsync(deck);
  const slide = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.equal((slide.match(/prst="ellipse"/g) || []).length, 5);
  assert.match(slide, /srgbClr val="FFA600"/);
  assert.match(slide, /≥ 10\.00 \(1\) 20%/);
});

test('PowerPoint fits 32 PCI entries in two columns before continuing a dense legend', async () => {
  const entries = Array.from({ length: 72 }, (_, index) => ({ label: `PCI ${100 + index}`, color: '#D24C11' }));
  const deck = await makeReport({
    location: 'Test site', keys: ['LTE_UE_PCI'],
    surveys: [{ filename: 'UE1.xlsx', metrics: [] }, { filename: 'UE2.xlsx', metrics: [] }],
    maps: [{
      key: 'LTE_UE_PCI', workbookIndex: 0, width: 1100, height: 530,
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFPsAAAAASUVORK5CYII=',
      legend: { title: 'LTE PCI legend', entries }, sectors: [],
    }, {
      key: 'LTE_UE_PCI', workbookIndex: 1, width: 1100, height: 530,
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFPsAAAAASUVORK5CYII=',
      legend: { title: 'Legend', entries: entries.slice(0, 32) },
    }],
  });
  const zip = await JSZip.loadAsync(deck);
  const slides = await Promise.all([2, 3, 4].map(number => zip.file(`ppt/slides/slide${number}.xml`).async('string')));
  assert.match(slides[0], /<p:pic>/);
  assert.match(slides[0], /S1 UE1/);
  assert.match(slides[2], /S2 UE2/);
  assert.match(slides[0], /\+40 values on following slides/);
  assert.doesNotMatch(slides[1], /<p:pic>/);
  assert.match(slides[1], /srgbClr val="D24C11"/);
  const labels = xml => [...xml.matchAll(/<a:t>(PCI \d+)<\/a:t>/g)].map(match => match[1]);
  const columns = [...slides[2].matchAll(/<a:tbl>.*?<\/a:tbl>/gs)].map(match => labels(match[0]));
  assert.deepEqual(columns, [entries.slice(0, 16).map(entry => entry.label), entries.slice(16, 32).map(entry => entry.label)]);
  assert.deepEqual(labels(slides[0] + slides[1]), entries.map(entry => entry.label));
  assert.equal(zip.file('ppt/slides/slide5.xml'), null);
});

test('reads shuffled sheets, sparse series, zero counts and positional summary pairs', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Sheet1');
  const histogram = workbook.addWorksheet('Histogram Formatted Data');
  histogram.addRow(['Survey totals']);
  histogram.addRow(['Range', 'LTE_UE_RSRP', undefined, 'Range', 'Voice_Call_EndResult']);
  histogram.addRow(['< -115', 0, undefined, 'Call complete', 36]);
  histogram.addRow(['-115 to -105', 221, undefined, 'Call drop', null]);
  const series = workbook.addWorksheet('Series Formatted Data');
  series.addRows([
    ['Message', 'Time', 'LTE_UE_RSRP', 'Nemo_Header_DeviceLabel', 'Latitude'],
    [1, '10:00', -95, 'Device A', -30],
    [2, '10:01', null, null, -30],
    [3, '10:02', -101, null, -30],
  ]);
  const stats = workbook.addWorksheet('Statistic Formatted Data');
  stats.addRows([['Statistic', 'LTE_UE_RSRP'], ['Mean', -98]]);
  const survey = await parseWorkbook(await workbook.xlsx.writeBuffer(), 'example.xlsx');
  assert.equal(survey.profile, 'Device A');
  assert.equal(survey.rows, 3);
  assert.deepEqual(survey.metrics, [
    { key: 'LTE_UE_RSRP', series: [[1, -95], [3, -101]], histogram: [['< -115', 0], ['-115 to -105', 221]], statistics: [['Mean', -98]] },
    { key: 'Voice_Call_EndResult', series: [], histogram: [['Call complete', 36]], statistics: [] },
  ]);
  assert.equal(survey.warnings.length, 1);
});

test('refuses a workbook with no recognized KPI data', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Other').addRow(['Not a survey']);
  await assert.rejects(parseWorkbook(await workbook.xlsx.writeBuffer(), 'wrong.xlsx'), /No usable KPI/);
});

test('keeps distribution labels and does not conflate zero with missing', () => {
  const items = [{ data: [['< -115', 0], ['Other', 2], ['Other', 3]] }, { data: [['Other', 5]] }];
  assert.deepEqual(sourceTable(items), [
    { label: '< -115', values: [0, null] },
    { label: 'Other', values: [2, 5] },
    { label: 'Other', values: [3, null] },
  ]);
});

test('downsampling preserves endpoints and outliers without filling gaps', () => {
  const source = Array.from({ length: 1_000 }, (_, i) => [i * 3 + 1, i === 345 ? 900 : i === 346 ? -500 : 15]);
  const plotted = samplePoints(source);
  assert.ok(plotted.length <= 240);
  assert.equal(plotted[0], source[0]);
  assert.equal(plotted.at(-1), source.at(-1));
  assert.ok(plotted.includes(source[345]) && plotted.includes(source[346]));
  assert.ok(plotted.every(point => source.includes(point)));
});

test('separates SVG chart and legend and produces a PowerPoint package', async () => {
  const key = 'LTE_UE_RSRP';
  const surveys = [{ filename: 'sample.xlsx', profile: 'UE <A>', metrics: [{
    key, histogram: Array.from({ length: binsPerPage + 1 }, (_, i) => [`Range ${i}`, i + 1]), series: [], statistics: [],
  }] }];
  const items = datasets(surveys, key, 'histogram');
  const visual = toSvg(chart('LTE RSRP', 'histogram', items, 1));
  assert.match(visual, new RegExp(`Range ${binsPerPage}`));
  assert.doesNotMatch(visual, /Range 0|UE &lt;A&gt;/);
  assert.match(toSvg(legend('LTE RSRP', items)), /UE &lt;A&gt;/);
  const buffer = Buffer.from(await makeReport({ location: 'Test location', surveys, keys: [key] }));
  assert.equal(buffer.subarray(0, 4).toString('hex'), '504b0304');
  assert.ok(buffer.includes('ppt/slides/slide3.xml'));
  assert.ok(!buffer.includes('ppt/slides/slide4.xml'));
});

test('combines the current plot page and its legend in one SVG image', () => {
  const items = [{ tag: 'S1', name: 'UE <A>', color: '#0D54FF',
    data: Array.from({ length: binsPerPage + 1 }, (_, i) => [`Range ${i}`, i + 1]) }];
  const plot = chart('LTE RSRP', 'histogram', items, 1);
  const key = legend('LTE RSRP', items);
  const combined = stackImages('LTE RSRP — plot and legend', ...[plot, key].map(model => ({ ...model, svg: toSvg(model) })));
  assert.match(combined, new RegExp(`^<svg [^>]+height="${plot.height + 12 + key.height}"`));
  assert.match(combined, new RegExp(`Range ${binsPerPage}[\\s\\S]*UE &lt;A&gt;`));
  assert.doesNotMatch(combined, /Range 0/);
});

test('keeps later workbooks in comparison groups on screen and gives each UE its own report slide', async () => {
  const key = 'LTE_UE_RSRP';
  const surveys = Array.from({ length: 10 }, (_, index) => ({
    filename: `sample-${index + 1}.xlsx`,
    metrics: index === 1 ? [] : [{ key, histogram: [['Range', index]], series: [], statistics: [] }],
  }));
  const groups = groupDatasets(datasets(surveys, key, 'histogram'));
  assert.deepEqual(groups.map(items => items.map(item => item.tag)), [
    ['S1', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'], ['S9', 'S10'],
  ]);
  const zip = await JSZip.loadAsync(await makeReport({ location: 'Test location', surveys, keys: [key] }));
  for (const [index, item] of groups.flat().entries()) {
    const slide = await zip.file(`ppt/slides/slide${index + 2}.xml`).async('string');
    assert.deepEqual([...new Set([...slide.matchAll(/<a:t>(S\d+)<\/a:t>/g)].map(match => match[1]))], [item.tag]);
    assert.ok(slide.includes(`${item.tag} ${item.name}`));
  }
  assert.equal(zip.file('ppt/slides/slide11.xml'), null);
});

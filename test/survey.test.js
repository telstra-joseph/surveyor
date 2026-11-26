import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { binsPerPage, chart, datasets, groupDatasets, legend, samplePoints, sourceTable, toSvg } from '../src/charts.js';
import { makeReport } from '../src/report.js';
import { mapImage, stackImages } from '../src/image-export.js';
import { parseWorkbook } from '../src/survey.js';
import { orderWorkbookBatch } from '../src/workers.js';
import { applySavedKpiOrder, defaultReportKpiOrder } from '../src/report-options.js';

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
    querySelectorAll: selector => layers[selector] || [],
  }, 'Test map');
  assert.match(svg, /translate\(20 30\)" opacity="0.4"><svg viewBox="0 0 11 11" width="22" height="22"/);
  assert.match(svg, /<g opacity="0.4"><rect x="45".*TEST<\/text><\/g>/);
  assert.doesNotMatch(svg, /BLOCKED/);
  assert.match(svg, /<image x="0" y="0" width="100" height="100" href="data:image\/png;base64,points"\/>/);
  const cropped = mapImage({
    clientWidth: 100, clientHeight: 100, clientLeft: 0, clientTop: 0, dataset: {}, classList: { contains: () => true },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    querySelector: () => ({ getBoundingClientRect: () => ({ left: 21.5, top: 12.75, width: 30.25, height: 56.5 }) }),
    querySelectorAll: selector => layers[selector] || [],
  }, 'Indoor map', false, { cropToFloorPlan: true });
  assert.deepEqual([cropped.width, cropped.height], [39, 66]);
  assert.match(cropped.svg, /<g transform="translate\(-17 -8\)".*data:image\/png;base64,points/);
});

test('PowerPoint prefers a map without a sector legend and retains a chart for a KPI without GPS', async () => {
  const deck = await makeReport({
    location: 'Test site', keys: ['LTE_UE_RSRP', 'LTE_UE_SINR'],
    surveys: [{ filename: 'test.xlsx', days: ['2026-10-14', '2026-10-13'], metrics: [
      { key: 'LTE_UE_RSRP', histogram: [['RSRP distribution', 5]] },
      { key: 'LTE_UE_SINR', histogram: [['SINR distribution', 3]] },
    ] }],
    maps: [{
      key: 'LTE_UE_RSRP', group: 0, width: 1100, height: 530,
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
  const chartSlide = await zip.file('ppt/slides/slide3.xml').async('string');
  assert.match(chartSlide, /SINR distribution/);
  assert.doesNotMatch(chartSlide, /<p:pic>/);
});

test('PowerPoint groups the selected KPIs into real workbook sections in the requested order', async () => {
  const surveys = ['second & co.xlsx', 'first.xlsx'].map((filename, i) => ({
    filename, profile: `Device ${i}`, sourceIndex: 1 - i, days: [`2026-10-1${i + 3}`], metrics: [
      { key: 'LTE_UE_SINR', series: [[0, i]] },
      { key: 'LTE_UE_RSRP', series: [[0, i - 100]] },
    ],
  }));
  const zip = await JSZip.loadAsync(await makeReport({
    location: 'Test site', keys: ['LTE_UE_SINR'], surveys, workbookSections: true,
  }));
  const read = name => zip.file(`ppt/${name}.xml`).async('string');
  const deck = await read('presentation');
  assert.deepEqual([...deck.matchAll(/<p14:section name="([^"]+)"[^>]*><p14:sldIdLst><p14:sldId id="(\d+)"\/><\/p14:sldIdLst>/g)]
    .map(match => match.slice(1)), [['Cover', '256'], ['1. second &amp; co.xlsx', '257'], ['2. first.xlsx', '258']]);
  assert.match(await read('slides/slide2'), /SINR.*second &amp; co\.xlsx/s);
  assert.match(await read('slides/slide3'), /SINR.*first\.xlsx/s);
  assert.match(await read('slides/slide2'), /<a:t>S2<\/a:t>/);
  assert.match(await read('slides/slide3'), /<a:t>S1<\/a:t>/);
  assert.equal(zip.file('ppt/slides/slide4.xml'), null);
});

test('PowerPoint inserts each custom divider before its workbook slides and inside its section', async () => {
  const key = 'LTE_UE_SINR';
  const zip = await JSZip.loadAsync(await makeReport({
    location: 'Test site', keys: [key], workbookSections: true,
    surveys: ['second.xlsx', 'first.xlsx'].map(filename => ({ filename, metrics: [{ key, series: [[0, 1]] }] })),
    dividerTitles: ['Lobby & entrance', 'Upper floor'],
  }));
  const slide = n => zip.file(`ppt/slides/slide${n}.xml`).async('string');
  assert.match(await slide(2), /<a:t>Lobby &amp; entrance<\/a:t>/);
  assert.match(await slide(3), /SINR.*second\.xlsx.*Page 3/s);
  assert.match(await slide(4), /<a:t>Upper floor<\/a:t>/);
  assert.match(await slide(5), /SINR.*first\.xlsx.*Page 5/s);
  const deck = await zip.file('ppt/presentation.xml').async('string');
  assert.match(deck, /name="1\. second\.xlsx"[^>]*><p14:sldIdLst><p14:sldId id="257"\/><p14:sldId id="258"\/>/);
  assert.match(deck, /name="2\. first\.xlsx"[^>]*><p14:sldIdLst><p14:sldId id="259"\/><p14:sldId id="260"\/>/);
  assert.equal(zip.file('ppt/slides/slide6.xml'), null);
});

test('PowerPoint centres a tightly cropped floor plan in the map area without online basemap text', async () => {
  const key = 'LTE_UE_RSRP';
  const zip = await JSZip.loadAsync(await makeReport({
    location: 'Test site', keys: [key], surveys: [{ days: ['2026-10-13'], metrics: [] }],
    maps: [{
      key, group: 0, plan: 'Level 2', width: 400, height: 600,
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
    ['LTE_UE_PCI', [entry(172, [{ name: 'SITEBM4', exact: true }]), entry(173)], ['172 — SITEBM4', '173']],
    ['NR_UE_PCI_0', [entry(85, [{ name: 'SITEVM1', exact: false }])], ['85 — SITEVM1 (candidate)']],
    ['LTE_UE_EARFCN_DL', [entry(1725), entry(9410), entry(5000)],
      ['LTE EARFCN', 'Channel number', '1725 — 1857.5 MHz', '9410 — 778 MHz', '5000 — frequency unavailable']],
    ['NR_UE_NR_ARFCN_DL_0', [entry(173000), entry(650000), entry(2016667)],
      ['NR-ARFCN', 'Channel number', '173000 — 865 MHz', '650000 — 3750 MHz', '2016667 — 24250.08 MHz']],
  ];
  const deck = await makeReport({
    location: 'Test site', keys: cases.map(([key]) => key), surveys: [],
    maps: cases.map(([key, entries]) => ({
      key, group: 0, width: 1100, height: 530,
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFPsAAAAASUVORK5CYII=',
      legend: { title: key === 'Technology_Mode' ? 'Technology mode legend' : 'Original heading', entries },
    })),
  });
  const zip = await JSZip.loadAsync(deck);
  for (const [index, [, , expected]] of cases.entries()) {
    const slide = await zip.file(`ppt/slides/slide${index + 2}.xml`).async('string');
    for (const text of expected) assert.ok(slide.includes(`<a:t>${text}</a:t>`), text);
    assert.doesNotMatch(slide, /Technology mode legend|downlink (?:EARFCN|ARFCN)/);
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
    location: 'Test site', keys: ['LTE_UE_SINR'], surveys: [],
    maps: [{
      key: 'LTE_UE_SINR', group: 0, width: 1100, height: 530,
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

test('PowerPoint continues a dense PCI legend at readable size without dropping its values', async () => {
  const entries = Array.from({ length: 72 }, (_, index) => ({ label: `PCI ${100 + index}`, color: '#D24C11' }));
  const deck = await makeReport({
    location: 'Test site', keys: ['LTE_UE_PCI'], surveys: [],
    maps: [{
      key: 'LTE_UE_PCI', group: 0, width: 1100, height: 530,
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFPsAAAAASUVORK5CYII=',
      legend: { title: 'LTE PCI legend', entries }, sectors: [],
    }],
  });
  const zip = await JSZip.loadAsync(deck);
  const slides = await Promise.all([2, 3, 4].map(number => zip.file(`ppt/slides/slide${number}.xml`).async('string')));
  assert.match(slides[0], /<p:pic>/);
  assert.match(slides[0], /\+56 values on following slides/);
  assert.doesNotMatch(slides.slice(1).join(''), /<p:pic>/);
  assert.match(slides[2], /srgbClr val="D24C11"/);
  assert.deepEqual([...slides.join('').matchAll(/<a:t>(PCI \d+)<\/a:t>/g)].map(match => match[1]), entries.map(entry => entry.label));
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

test('keeps later workbooks in comparison groups and gives each group a report slide', async () => {
  const key = 'LTE_UE_RSRP';
  const surveys = Array.from({ length: 10 }, (_, index) => ({
    filename: `sample-${index + 1}.xlsx`,
    metrics: index === 1 ? [] : [{ key, histogram: [['Range', index]], series: [], statistics: [] }],
  }));
  const groups = groupDatasets(datasets(surveys, key, 'histogram'));
  assert.deepEqual(groups.map(items => items.map(item => item.tag)), [
    ['S1', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'], ['S9', 'S10'],
  ]);
  const buffer = Buffer.from(await makeReport({ location: 'Test location', surveys, keys: [key] }));
  assert.ok(buffer.includes('ppt/slides/slide3.xml'));
  assert.ok(!buffer.includes('ppt/slides/slide4.xml'));
});

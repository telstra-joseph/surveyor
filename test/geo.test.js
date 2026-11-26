import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { closestSnapshot, mapFeatures, mapWorkbook, parseActix, radioFields } from '../src/geo.js';
import { makeKml, makeShapefile } from '../src/gis-export.js';
import { callDropKey, datasets, legendImage, toSvg } from '../src/charts.js';
import { mapLegendExportEntry, mapLegendFilter, mapPointLegend } from '../src/map-colors.js';
import { applyMapThresholds } from '../src/map-thresholds.js';
import { detectedCellOverlay, mapSectors, sectorLegendGroups } from '../src/sector-style.js';
import { parseWorkbook } from '../src/survey.js';

const lte = `SiteID,Latitude,Longitude,Sector_ID,DL_EARFCN,PCI,ECI,Cell_Name
far,-35,153,B,1725,8,987,Far LTE
near,-32.8,151.6,A,1725,8,123,`;

test('maps only geolocated call drop events with a single event legend', () => {
  const metric = { key: callDropKey, geoCount: 4, series: [[1, 0], [2, 1], [3, 2], [4, 1]], geoCategories: [[5, 'unknown']] };
  const location = { coords: [151.61, -32.81], radio: {} };
  const survey = { filename: 'UE1.xlsx', metrics: [metric], geography: { 1: location, 2: location, 3: location, 5: location } };
  const noMappedDrop = { ...survey, geography: { 1: location, 3: location, 5: location } };
  const items = datasets([survey, noMappedDrop], callDropKey, 'map');
  assert.deepEqual(items.map(({ tag }) => tag), ['S1']);
  const map = mapFeatures({ key: callDropKey, workbooks: [mapWorkbook(survey, callDropKey, 'S1', '#000000')],
    snapshots: [], maxDays: 7, legendMode: 'ue' });
  const { entries } = mapPointLegend(callDropKey, map, items);
  assert.deepEqual(entries.map(({ label }) => label), ['Drop detected']);
  assert.deepEqual(map.samples.features.map(({ properties }) => [properties.LOG_ROW, properties.VALUE, properties.COLOR]),
    [[2, 1, entries[0].color]]);
});

test('groups and deduplicates sector bands without guessing unmapped frequencies', () => {
  const sectors = [
    { rat: 'NR', carrier: 'DA' }, { rat: 'LTE', carrier: 'H' }, { rat: 'NR', carrier: 'V' },
    { rat: 'LTE', carrier: 'H' }, { rat: 'LTE', carrier: 'W' }, { rat: 'NR', carrier: 'W' }, { rat: 'NR', carrier: 'X' },
  ];
  assert.deepEqual(sectorLegendGroups(sectors).map(({ rat, entries }) => [rat, entries.map(({ label }) => label)]), [
    ['LTE', ['H 850e MHz', 'W']],
    ['NR', ['V 850 MHz', 'W 850 MHz', 'X 2600 MHz', 'D 26000 MHz']],
  ]);
});

test('colours the technology map by same-row series values, not workbook names or histogram bins', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Histogram Formatted Data').addRows([
    ['Range', 'Technology_Mode'], ['Histogram only', 50],
  ]);
  workbook.addWorksheet('Series Formatted Data').addRows([
    ['Longitude', 'Latitude', 'technology_mode'],
    [151.61, -32.81, 'LTE'],
    [151.62, -32.82, 'LTE-5GNR'],
    [151.63, -32.83, 'LTE'],
    [151.64, -32.84, 5],
    [151.65, -32.85, null],
    [null, -32.86, 'No GPS'],
  ]);
  const survey = await parseWorkbook(await workbook.xlsx.writeBuffer(), 'UE1.xlsx');
  const map = mapFeatures({
    workbooks: [{ survey, tag: 'S1', color: '#000000' }, { survey, tag: 'S2', color: '#ffffff' }],
    key: 'Technology_Mode', snapshots: [], maxDays: 7,
  });
  assert.equal(map.extent, null);
  assert.deepEqual(map.thresholdLegend, []);
  assert.deepEqual(map.categoryLegend.map(({ label }) => label), ['5', 'LTE', 'LTE-5GNR']);
  const colors = new Map(map.categoryLegend.map(({ label, color }) => [label, color]));
  assert.equal(new Set(colors.values()).size, 3);
  for (const tag of ['S1', 'S2']) {
    const points = map.samples.features.filter(({ properties }) => properties.DEVICE === tag);
    assert.deepEqual(points.map(({ properties }) => [properties.LOG_ROW, properties.CATEGORY, properties.COLOR]),
      ['LTE', 'LTE-5GNR', 'LTE', '5'].map((mode, index) => [index + 1, mode, colors.get(mode)]));
  }
});

test('builds PCI and channel legends from same-row GPS values and prioritises contrast between neighbours', async () => {
  const keys = ['LTE_UE_PCI', 'NR_UE_PCI_0', 'LTE_UE_EARFCN_DL', 'NR_UE_NR_ARFCN_DL_0'];
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Series Formatted Data').addRows([
    ['Longitude', 'Latitude', ...keys],
    [151.62, -32.82, 0, 0, 1850, 632628],
    [151.6201, -32.82, 20, 20, 1950, 632629],
    [151.62, -32.82, 0, 0, 1850, 632628],
    [152.62, -32.82, 1, 1, 1900, 632627],
    [null, -32.82, 3, 3, 2000, 632630],
    [151.62, -32.82, null, null, null, null],
  ]);
  const survey = await parseWorkbook(await workbook.xlsx.writeBuffer(), 'UE1.xlsx');
  const workbooks = ['S1', 'S2'].map(tag => ({ survey, tag, color: '#000000' }));
  for (const [index, key] of keys.entries()) {
    const expected = [[0, 1, 20], [0, 1, 20], [1850, 1900, 1950], [632627, 632628, 632629]][index];
    const map = mapFeatures({ workbooks, key, snapshots: [], maxDays: 7 });
    assert.deepEqual(map.categoryLegend.map(({ label }) => label), expected.map(String));
    const colors = new Map(map.categoryLegend.map(({ label, color }) => [Number(label), color]));
    assert.equal(new Set(colors.values()).size, 3);
    assert.equal(map.samples.features.length, 8);
    for (const { properties } of map.samples.features) assert.equal(properties.COLOR, colors.get(properties.VALUE));
    const distance = (a, b) => {
      const channels = color => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
      const second = channels(b);
      return Math.hypot(...channels(a).map((value, i) => value - second[i]));
    };
    const nearby = index === 3 ? 1 : 0, distant = 1 - nearby;
    const shared = colors.get(expected[nearby]);
    assert.ok(distance(shared, colors.get(expected[2])) > 220);
    assert.ok(distance(shared, colors.get(expected[2])) > distance(shared, colors.get(expected[distant])));
  }
});

test('keeps continuous measurements on a value scale and maps text-only KPIs as categories', () => {
  const geography = [{ coords: [151, -32], radio: {} }, { coords: [151.001, -32], radio: {} }];
  const makeMap = metric => mapFeatures({ key: metric.key, snapshots: [], maxDays: 7,
    workbooks: [{ survey: { metrics: [metric], geography }, tag: 'S1', color: '#000000' }] });
  const continuous = makeMap({ key: 'Custom_Measurement', series: [[0, 4.5], [1, 6.1]] });
  assert.deepEqual(continuous.categoryLegend, []);
  assert.deepEqual(continuous.valueLegend.map(({ label }) => label), ['4.5', '6.1']);
  assert.deepEqual(continuous.samples.features.map(({ properties }) => properties.COLOR), continuous.valueLegend.map(({ color }) => color));
  const categorical = makeMap({ key: 'Custom_Status', series: [], geoCategories: [[0, 'Active'], [1, 'Idle']] });
  assert.deepEqual(categorical.categoryLegend.map(({ label }) => label), ['Active', 'Idle']);
  assert.notEqual(categorical.categoryLegend[0].color, categorical.categoryLegend[1].color);
});

test('isolates a legend value without changing shares or confusing identical colours and rounded labels', () => {
  const samples = { type: 'FeatureCollection', features: [
    { properties: { VALUE: 0, COLOR: '#0D54FF' } },
    { properties: { VALUE: 0, COLOR: '#0D54FF' } },
    { properties: { VALUE: 21, COLOR: '#0D54FF' } },
  ] };
  const categoryMap = { samples, categoryLegend: [0, 21].map(value => ({ label: String(value), value, color: '#0D54FF' })),
    thresholdLegend: [], valueLegend: [] };
  const filter = mapLegendFilter(categoryMap, mapPointLegend('LTE_UE_PCI', categoryMap, []).entries);
  const [zero, twentyOne] = filter.entries;
  assert.deepEqual(filter.samples(zero).features, samples.features.slice(0, 2));
  assert.deepEqual(filter.samples(twentyOne).features, samples.features.slice(2));
  assert.deepEqual(filter.entries.map(({ share }) => share), ['66.7%', '33.3%']);
  assert.equal(filter.samples(), samples);

  const valueMap = { categoryLegend: [], thresholdLegend: [], samples: { type: 'FeatureCollection',
    features: [1, 1.00001, 1.00002].map(VALUE => ({ properties: { VALUE } })) },
    valueLegend: [1, 1.00002].map(value => ({ value, label: '1' })) };
  const endpoints = mapLegendFilter(valueMap, mapPointLegend('measurement', valueMap, []).entries);
  assert.deepEqual(endpoints.entries.map(({ share }) => share), ['33.3%', '33.3%']);
  assert.deepEqual(endpoints.samples(endpoints.entries[1]).features, valueMap.samples.features.slice(2));
});

test('uses the same RSRP coverage bands for single-UE LTE and NR maps, including exact boundaries', () => {
  const device = (key, tag, values, geography) => ({
    survey: { filename: `${tag}.xlsx`, metrics: [{ key, series: values.map((value, row) => [row, value]) }], geography },
    tag, color: '#663399',
  });
  const values = [-115.01, -115, -105.01, -105, -95.01, -95];
  const geography = values.map((_, row) => ({ coords: [151 + row / 100, -32], radio: {} }));
  const good = ['Good: ≥ -95 dBm', '#0000FF'];
  const moderate = ['Moderate: -105 to < -95 dBm', '#00FF00'];
  const basic = ['Basic: -115 to < -105 dBm', '#FFFF00'];
  const none = ['No coverage: < -115 dBm', '#FF0000'];
  for (const key of ['LTE_UE_RSRP', 'NR_UE_RSRP_0']) {
    const first = device(key, 'S1', values, geography);
    const buildMap = workbooks => mapFeatures({ workbooks, snapshots: [], key, maxDays: 7 });
    const single = buildMap([first, device(key, 'S2', [-75], [])]);
    assert.deepEqual(single.thresholdLegend.map(({ label, color }) => [label, color]), [good, moderate, basic, none]);
    assert.deepEqual(single.samples.features.map(({ properties }) => [properties.KPI_BAND, properties.COLOR]),
      [none, basic, basic, moderate, moderate, good]);
    const multi = buildMap([first, device(key, 'S2', [-75], geography)]);
    assert.deepEqual(multi.thresholdLegend, []);
    assert.ok(multi.samples.features.every(({ properties }) => !properties.KPI_BAND && properties.COLOR === '#663399'));
    const workbooks = [first, device(key, 'S2', [-95], geography), { ...device(key, 'S3', [-120], geography), color: '#007266' }];
    const compare = legendMode => mapFeatures({ workbooks, snapshots: [], key, maxDays: 7, legendMode });
    const byThreshold = compare('thresholds');
    assert.deepEqual(byThreshold.thresholdLegend.map(({ label, color }) => [label, color]), [good, moderate, basic, none]);
    assert.equal(byThreshold.samples.features.at(-1).properties.COLOR, '#FF0000');
    const byUe = compare('ue');
    assert.equal(byUe.ueColors, true);
    assert.deepEqual(byUe.thresholdLegend, []);
    assert.equal(byUe.samples.features.at(-1).properties.COLOR, '#007266');
  }
});

test('uses the reference SINR bands, counts and colours at every boundary', () => {
  const values = [-5.01, -5, -.01, 0, 4.99, 5, 9.99, 10, 10.01];
  const bands = [
    { label: 'Below -5.00', color: '#FF0000' },
    { label: '≥ -5.00 to < 0.00', color: '#FFA600' },
    { label: '≥ 0.00 to < 5.00', color: '#FFFF00' },
    { label: '≥ 5.00 to < 10.00', color: '#00FF00' },
    { label: '≥ 10.00', color: '#008000' },
  ];
  for (const key of ['LTE_UE_SINR', 'NR_UE_SINR_0', 'NR_UE_SINR_1', 'NR SS-SINR']) {
    const workbook = {
      survey: {
        filename: 'sinr.xlsx',
        metrics: [{ key, series: values.map((value, row) => [row, value]) }],
        geography: values.map((_, row) => ({ coords: [151 + row / 100, -32], radio: {} })),
      },
      tag: 'S1', color: '#663399',
    };
    const map = mapFeatures({ workbooks: [workbook], snapshots: [], key, maxDays: 7 });
    assert.deepEqual(map.thresholdLegend, bands, key);
    assert.deepEqual(map.samples.features.map(({ properties }) => [properties.KPI_BAND, properties.COLOR]),
      [0, 1, 1, 2, 2, 3, 3, 4, 4].map(index => [bands[index].label, bands[index].color]), key);
    const legend = mapPointLegend(key, map, [workbook]);
    assert.equal(legend.showCounts, true);
    const filter = mapLegendFilter(map, legend.entries);
    assert.deepEqual(filter.entries.map(({ count, share }) => [count, share]),
      [[1, '11.1%'], [2, '22.2%'], [2, '22.2%'], [2, '22.2%'], [2, '22.2%']]);
    assert.deepEqual(filter.samples(filter.entries[4]).features.map(({ properties }) => properties.VALUE), [10, 10.01]);
    const exported = filter.entries.map(entry => mapLegendExportEntry(entry, legend.showCounts));
    assert.equal(exported[0].label, 'Below -5.00 (1) 11.1%');
    assert.equal(exported[4].label, '≥ 10.00 (2) 22.2%');
    const svg = toSvg(legendImage('SINR', exported));
    assert.equal((svg.match(/<circle /g) || []).length, 5);
    assert.match(svg, /fill="#FFA600"/);
    assert.match(svg, /≥ 10\.00 \(2\) 22\.2%/);
  }
});

test('report threshold overrides change points and legend without changing normal map thresholds', () => {
  const key = 'LTE_UE_SINR';
  const readings = [-5, 10, 12];
  const workbooks = readings.map((value, i) => ({
    survey: { filename: `${i}.xlsx`, metrics: [{ key, series: [[0, value]] }],
      geography: [{ coords: [151 + i / 100, -32], radio: {} }] },
    tag: `S${i + 1}`, color: '#663399',
  }));
  const thresholdOverride = { cuts: [-5, 0, 5, 12], bands: [
    { label: 'Below -5.00', color: '#FF0000' }, { label: '≥ -5.00 to < 0.00', color: '#FFA600' },
    { label: '≥ 0.00 to < 5.00', color: '#FFFF00' }, { label: '≥ 5.00 to < 10.00', color: '#00FF00' },
    { label: 'Excellent', color: '#123456' },
  ] };
  const input = { workbooks, snapshots: [], key, maxDays: 7 };
  const report = mapFeatures({ ...input, legendMode: 'ue', thresholdOverride });
  assert.deepEqual(report.samples.features.map(({ properties }) => [properties.KPI_BAND, properties.COLOR]), [
    ['≥ -5.00 to < 0.00', '#FFA600'], ['≥ 5 to < 12 dB', '#00FF00'], ['Excellent', '#123456'],
  ]);
  assert.deepEqual(report.thresholdLegend.slice(-2), [
    { label: '≥ 5 to < 12 dB', color: '#00FF00' }, { label: 'Excellent', color: '#123456' },
  ]);
  assert.equal(mapFeatures({ ...input, legendMode: 'thresholds' }).samples.features[1].properties.COLOR, '#008000');
  assert.throws(() => mapFeatures({ ...input, thresholdOverride: { ...thresholdOverride, cuts: [-5, 0, 5, 5] } }), /strictly increasing/);
});

test('marks below-threshold readings red without colouring missing or above-range readings red', () => {
  const cases = [
    ['NR_UE_RSRP_0', [-115.01, -115], 'No coverage: < -115 dBm'],
    ['LTE_UE_SINR', [-5.01, -5], 'Below -5.00'],
    ['NR_UE_SINR_0', [-5.01, -5], 'Below -5.00'],
    ['Speech_MOS_POLQA_Score_DL', [2.99, 3], '< 3 MOS'],
    ['App_Throughput_DL', [9_999, 10_000], '< 10 Mbps'],
    ['App_Throughput_UL', [0, 2_000], '< 2 Mbps'],
  ];
  for (const [key, values, label] of cases) {
    const features = [...values, null].map(VALUE => ({ properties: { DEVICE: 'S1', VALUE } }));
    const legend = applyMapThresholds(key, features);
    assert.deepEqual(legend.find(entry => entry.label === label), { label, color: '#FF0000' }, key);
    assert.deepEqual(features.map(({ properties }) => properties.COLOR === '#FF0000'), [true, false, false], key);
  }
  const maximum = { properties: { DEVICE: 'S1', VALUE: 5 } };
  const above = { properties: { DEVICE: 'S1', VALUE: 5.01 } };
  const key = 'Speech_MOS_POLQA_Score_DL';
  assert.deepEqual(applyMapThresholds(key, [maximum]).map(({ label }) => label), ['4 to 5 MOS', '3 to < 4 MOS', '< 3 MOS']);
  assert.equal(maximum.properties.KPI_BAND, '4 to 5 MOS');
  applyMapThresholds(key, [above]);
  assert.equal(above.properties.KPI_BAND, 'Out-of-range reading');
  assert.equal(above.properties.COLOR, '#717888');
});

test('classifies Nemo throughput in kbps without changing the source values', () => {
  const key = 'App_Throughput_UL';
  const values = [5_000, 10_000, 20_000, 20_001];
  const survey = {
    filename: 'upload.xlsx',
    metrics: [{ key, series: values.map((value, row) => [row, value]) }],
    geography: values.map((_, row) => ({ coords: [151 + row / 100, -32], radio: {} })),
  };
  const map = mapFeatures({ workbooks: [{ survey, tag: 'S1', color: '#663399' }], snapshots: [], key, maxDays: 7 });
  assert.deepEqual(map.samples.features.map(({ properties }) => [properties.VALUE, properties.KPI_BAND]), [
    [5_000, '2 to 5 Mbps'], [10_000, '> 5 to 10 Mbps'], [20_000, '> 10 to 20 Mbps'], [20_001, '> 20 Mbps'],
  ]);
});

test('chooses a dated snapshot by RAT and age, preferring a prior snapshot when tied', () => {
  const prior = parseActix(lte, 'actix 2026-10-13 0810.csv');
  const later = parseActix(lte, 'actix 2026-10-15 0810.csv');
  assert.deepEqual(closestSnapshot([later, prior], 'LTE', '2026-10-14', 1), { snapshot: prior, days: -1 });
  assert.equal(closestSnapshot([prior], 'NR', '2026-10-14', 7), null);
  assert.equal(closestSnapshot([prior], 'LTE', '2026-10-14', 0), null);
  assert.throws(() => parseActix(lte, 'actix.csv'), /snapshot date/);
});

test('reports only the distinct snapshot dates used by the map', () => {
  const snapshots = ['2026-10-15', '2026-10-13', '2026-10-20'].map(day => parseActix(lte, `actix ${day}.csv`));
  const key = 'LTE_UE_RSRP';
  const survey = {
    filename: 'survey.xlsx',
    network: 'telstra',
    metrics: [{ key, series: [[0, -95], [1, -99], [2, -100]] }],
    geography: ['2026-10-15', '2026-10-13', '2026-10-15'].map(day => ({
      day, coords: [151.61, -32.81], radio: { LTE: [987, 8, 1725] },
    })),
  };
  const build = loaded => mapFeatures({ key, maxDays: 0, snapshots: loaded, workbooks: [{ survey, tag: 'S1', color: '#000000' }] });
  assert.deepEqual(build(snapshots).snapshotDays, ['2026-10-13', '2026-10-15']);
  assert.deepEqual(build(snapshots.slice(-1)).snapshotDays, []);
  assert.deepEqual(build([]).snapshotDays, []);
});

test('labels LTE and NR PCI legends with distinct exact or candidate names without guessing ties', () => {
  for (const [rat, key, header] of [
    ['LTE', 'LTE_UE_PCI', 'DL_EARFCN,PCI,ECI'],
    ['NR', 'NR_UE_PCI_0', 'DL_NR_ARFCN,NR_PCI,NCI'],
  ]) {
    const snapshot = parseActix(`SiteID,Latitude,Longitude,${header},CELL_NAME
A,-32,151,1500,8,100,Exact Cell
B,-33,152,1500,8,200,Another Cell
C,-32,151,1500,9,300,Tied Cell A
C,-32,151,1500,9,301,Tied Cell B
D,-32,151,1500,10,400,Other Network Cell`, 'actix 2026-10-13.csv');
    const day = '2026-10-13';
    const device = (tag, network, rows) => ({ tag, color: '#000000', survey: {
      filename: `${tag}.xlsx`, network, metrics: [{ key, series: rows.map(([pci], row) => [row, pci]) }],
      geography: rows.map(([pci, id, coords]) => ({ coords, day, radio: { [rat]: [id, pci, 1500] } })),
    } });
    const workbooks = [
      device('S1', 'telstra', [[8, null, [151, -32]], [8, 100, [151, -32]], [8, null, [152, -33]], [9, null, [151, -32]]]),
      device('S2', 'other', Array.from({ length: 4 }, () => [10, 400, [151, -32]])),
    ];
    const map = mapFeatures({ workbooks, snapshots: [snapshot], key, maxDays: 0 });
    assert.deepEqual(map.categoryLegend.map(({ value, cells }) => [value, cells]), [
      [10, undefined],
      [8, [{ name: 'Another Cell', exact: false }, { name: 'Exact Cell', exact: true }]],
      [9, undefined],
    ]);
    const legend = mapPointLegend(key, map, []);
    assert.equal(legend.title, 'Legend');
    const filter = mapLegendFilter(map, legend.entries);
    assert.deepEqual(filter.entries.map(({ count }) => count), [4, 3, 1]);
    assert.equal(filter.entries[0].share, '50%');
    assert.equal(filter.samples(filter.entries[0]).features.length, 4);
    const withoutActix = mapFeatures({ workbooks, snapshots: [], key, maxDays: 0 });
    assert.ok(withoutActix.categoryLegend.every(entry => !entry.cells));
  }
});

test('carries LTE and NR identities forward in row order, stopping at handovers and radio changes', async () => {
  for (const [rat, fields] of Object.entries(radioFields)) {
    const [, key] = fields;
    const headers = rat === 'LTE' ? 'ECI,PCI,DL_EARFCN' : 'NCI,NR_PCI,DL_NR_ARFCN';
    const snapshot = parseActix(`SiteID,Latitude,Longitude,${headers},CELL_NAME
A,-35,153,100,8,1500,Far
B,-32,151,200,8,1500,Near
C,-32,151,300,8,1600,Other Channel`, 'actix 2026-10-13.csv');
    const device = async (tag, rows) => {
      const workbook = new ExcelJS.Workbook();
      workbook.addWorksheet('Series Formatted Data').addRows([
        ['Time', 'Longitude', 'Latitude', ...fields],
        ...rows.map(([id, pci, channel, gps = true], index) => [
          index === 0 ? '2026-10-13 08:00:00' : null, gps ? 151 : null, -32, id, pci, channel,
        ]),
      ]);
      return mapWorkbook(await parseWorkbook(await workbook.xlsx.writeBuffer(), `${tag}.xlsx`), key, tag, '#000000');
    };
    const first = await device('S1', [
      [null, 8, 1500],
      [100, 8, 1500, false],
      [null, 8, 1500],
      [200, 8, 1500],
      [null, 8, null],
      [null, 9, 1500, false],
      [null, 8, 1500],
      [100, null, 1500, false],
      [null, 8, 1500],
      [null, 8, 1600],
      [null, 8, 1500],
      [999, 8, 1500, false],
      [null, 8, 1500],
    ]);
    const second = await device('S2', [[null, 8, 1500]]);
    const map = mapFeatures({ workbooks: [first, second], key, snapshots: [snapshot], maxDays: 0 });
    const prefix = rat === 'LTE' ? 'L' : 'N';
    assert.deepEqual(map.samples.features.map(({ properties: p }) => [p.DEVICE, p.LOG_ROW, p[`${prefix}_CELL`], p[`${prefix}_MATCH`]]), [
      ['S1', 1, '200', 'PCI/channel candidate'],
      ['S1', 3, '100', 'Exact ID'],
      ['S1', 4, '200', 'Exact ID'],
      ['S1', 5, '200', 'Exact ID'],
      ['S1', 7, '200', 'PCI/channel candidate'],
      ['S1', 9, '100', 'Exact ID'],
      ['S1', 10, '300', 'PCI/channel candidate'],
      ['S1', 11, '200', 'PCI/channel candidate'],
      ['S1', 13, '', 'Unmatched'],
      ['S2', 1, '200', 'PCI/channel candidate'],
    ], rat);
    assert.deepEqual(map.categoryLegend[0].cells, [
      { name: 'Far', exact: true }, { name: 'Near', exact: true }, { name: 'Other Channel', exact: false },
    ]);
    assert.deepEqual(first.survey.metrics.find(item => item.key === fields[0]).series, [[2, 100], [4, 200], [8, 100], [12, 999]]);
  }
});

test('maps same-row GPS and exports identity-based matches', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Series Formatted Data').addRows([
    ['Time', 'Longitude', 'Latitude', 'LTE_UE_RSRP', 'LTE_Uu_RRC_ECI', 'LTE_UE_PCI', 'LTE_UE_EARFCN_DL', 'LTE_UE_MCC', 'LTE_UE_MNC'],
    ['2026-10-14 08:00:00', 151.61, -32.81, -95, 987, 8, 1725, 505, '01'],
    [undefined, 151.62, -32.82, -99, null, 8, 1725],
    [undefined, 151.63, -32.83, -101, 555, 8, 1725],
    [undefined, 0, 0, -103, 987, 8, 1725],
  ]);
  const survey = await parseWorkbook(await workbook.xlsx.writeBuffer(), 'sample <survey>.xlsx');
  const map = mapFeatures({ workbooks: [{ survey, tag: 'S1', color: '#000000' }],
    key: 'LTE_UE_RSRP', maxDays: 7, snapshots: [parseActix(lte, 'actix.csv', '2026-10-13')] });
  const points = map.samples.features.map(({ properties }) => properties);
  assert.deepEqual(points.map(p => [p.L_MATCH, p.L_CELL, p.L_COUNT]), [
    ['Exact ID', '987', 1], ['Exact ID', '987', 1], ['Unmatched', '', null],
  ]);
  assert.deepEqual(points.map(p => p.L_NAME), ['Far LTE', 'Far LTE', '']);
  assert.equal(points[1].L_DAYS, -1);
  assert.deepEqual(map.extent, [-101, -95]);
  assert.equal(map.sites.features.length, 1);
  assert.deepEqual(map.samples.features.map(({ siteLinks }) => siteLinks?.map(({ siteId, exact }) => [
    map.sites.features.find(site => site.id === siteId).geometry.coordinates, exact,
  ])), [[[[153, -35], true]], [[[153, -35], true]], undefined]);
  assert.deepEqual(map.sectors, []);
  const kml = makeKml(map, 'LTE <survey>');
  assert.match(kml, /LTE &lt;survey&gt;|sample &lt;survey&gt;/);
  assert.match(kml, /<coordinates>151\.62,-32\.82<\/coordinates>/);
  assert.equal(kml.match(/<Placemark>/g).length, 4);
  const zip = Buffer.from(await makeShapefile(map));
  assert.equal(zip.subarray(0, 4).toString('hex'), '504b0304');
  for (const ext of ['shp', 'shx', 'dbf', 'prj']) assert.ok(zip.includes(`survey_points.${ext}`));
});

test('PCI maps colour co-directed cells separately using the selected radio technology and legend', () => {
  const snapshots = [
    parseActix(`SiteID,Latitude,Longitude,Azimuth,Beamwidth,DL_EARFCN,PCI,ECI,CELL_NAME
site,-32,151,0,60,1725,0,123,SITEFM1
site,-32,151,0,60,1726,8,124,SITEFM1
site,-32,151,120,60,1725,9,125,SITEEM2`, 'actix 2026-10-13.csv'),
    parseActix(`SiteID,Latitude,Longitude,Azimuth,Beamwidth,DL_NR_ARFCN,NR_PCI,NCI,CELL_NAME
site,-32,151,0,60,650000,0,223,SITEVM1
site,-32,151,0,60,650001,8,224,SITEVM1`, 'actix 2026-10-13.csv'),
  ];
  for (const [rat, [, key]] of Object.entries(radioFields)) {
    const survey = {
      filename: 'test.xlsx', network: 'telstra', metrics: [{ key, series: [[0, 0], [1, 8]] }],
      geography: [
        { coords: [151.01, -32.01], day: '2026-10-13', radio: { LTE: [123, 0, 1725], NR: [223, 0, 650000] } },
        { coords: [151.02, -32.02], day: '2026-10-13', radio: { LTE: [124, 8, 1726], NR: [224, 8, 650001] } },
      ],
    };
    const map = mapFeatures({ workbooks: [{ survey, tag: 'S1', color: '#000000' }], key, maxDays: 0, snapshots });
    const styled = mapSectors(map, true);
    assert.deepEqual(styled.filter(sector => sector.pciColor).map(sector => [sector.rat, sector.pci, sector.pciColor]),
      map.categoryLegend.map(({ value, color }) => [rat, value, color]));
    assert.equal(mapSectors(map, false).some(sector => sector.pciColor), false);
    if (rat === 'LTE') {
      assert.deepEqual(sectorLegendGroups(styled).map(({ rat, entries }) => [rat, entries.map(({ label }) => label)]),
        [['LTE', ['E 1800 MHz']], ['NR', ['V 850 MHz']]]);
    }
  }
});

test('keeps co-directed carriers distinct and draws only valid snapshot angles at associated sites', () => {
  const snapshot = parseActix(`SiteID,Latitude,Longitude,Sector_ID,Azimuth,Beamwidth,DL_NR_ARFCN,NR_PCI,NCI,CELL_NAME
site,-32,151,A,360,60,650000,8,123,SITEVM1
site,-32,151,A,0,60,650001,8,124,SITEVM1
site,-32,151,B,0,60,650000,9,125,SITEDM2A
site,-32,151,SITEHM3,120,60,650000,9,130,
site,-32,151,C,,360,650000,10,126,
site,-32,151,D,,60,650000,11,127,SITEJM3
site,-32,151,E,210,361,650000,12,128,
unmatched,-33,152,A,90,60,650000,13,129,`, 'actix 2026-10-13.csv');
  const survey = {
    filename: 'test.xlsx', network: 'telstra',
    metrics: [{ key: 'test', series: [[1, -90]] }],
    geography: { 1: { coords: [151.01, -32.01], day: '2026-10-13', radio: { NR: [123, null, null] } } },
  };
  const map = mapFeatures({ workbooks: [{ survey, tag: 'S1', color: '#000000' }], key: 'test', maxDays: 0, snapshots: [snapshot] });
  assert.deepEqual(map.sectors, [[0, 60, 'V'], [0, 60, 'DA'], [120, 60, 'H'], [0, 360, '']].map(([azimuth, beamwidth, carrier]) =>
    ({ rat: 'NR', coords: [151, -32], azimuth, beamwidth, carrier })));
  assert.deepEqual(map.samples.features[0].siteLinks, [{ siteId: map.sites.features[0].id, exact: true }]);
  assert.deepEqual(map.sites.features[0].angles, { azimuth: 0, beamwidth: 60 });
  assert.equal(map.sites.features[0].carrier, 'V');
  assert.equal(map.samples.features[0].properties.N_NAME, 'SITEVM1');
  assert.equal(map.sites.features.length, 1);
});

test('detected-only overlays follow visible sample links, not the whole site or every cell sharing its PCI', () => {
  const lteSnapshot = parseActix(`SiteID,Latitude,Longitude,Azimuth,Beamwidth,DL_EARFCN,PCI,ECI
site,-32,151,0,60,1725,8,123
site,-32,151,120,60,1725,8,124
site,-32,151,240,60,1725,9,125`, 'actix 2026-10-13.csv');
  const nrSnapshot = parseActix(`SiteID,Latitude,Longitude,Azimuth,Beamwidth,DL_NR_ARFCN,NR_PCI,NCI
site,-32,151,0,60,650000,8,223`, 'actix 2026-10-13.csv');
  const [, key] = radioFields.LTE;
  const survey = {
    filename: 'test.xlsx', network: 'telstra',
    metrics: [{ key, series: [[0, 8], [1, 9], [2, 10]] }],
    geography: [123, 125, 999].map((id, row) => ({
      coords: [151.01 + row / 100, -32.01], day: '2026-10-13', radio: { LTE: [id, 8 + row, 1725], NR: [223, 8, 650000] },
    })),
  };
  const map = mapFeatures({ workbooks: [{ survey, tag: 'S1', color: '#000000' }], key, maxDays: 0, snapshots: [lteSnapshot, nrSnapshot] });
  assert.equal(map.sectors.length, 4);
  const filter = mapLegendFilter(map, map.categoryLegend);
  const overlay = { ...map, sectors: mapSectors(map, true) };
  const summarize = ({ sites, sectors }) => ({
    cells: sites.features.map(site => site.properties.CELL_ID),
    sectors: sectors.map(({ rat, azimuth, pci, pciColor }) => [rat, azimuth, pci, pciColor]),
  });
  const color = value => map.categoryLegend.find(entry => entry.value === value).color;
  assert.deepEqual(summarize(detectedCellOverlay(overlay, map.samples)),
    { cells: ['123', '125'], sectors: [['LTE', 0, 8, color(8)], ['LTE', 240, 9, color(9)]] });
  const isolate = value => summarize(detectedCellOverlay(overlay, filter.samples(filter.entries.find(entry => entry.value === value))));
  assert.deepEqual(isolate(8), { cells: ['123'], sectors: [['LTE', 0, 8, color(8)]] });
  assert.deepEqual(isolate(10), { cells: [], sectors: [] });
});

test('matches unidentified logs as assumed Telstra but skips logs with non-Telstra evidence', async () => {
  const cases = [
    { device: 'UE Telstra', plmn: '50501', result: 'Exact ID', network: 'Telstra' },
    { device: 'UE Telstra', plmn: '505-02', result: 'Skipped: non-Telstra evidence' },
    { device: 'UE Optus', plmn: '50501', result: 'Skipped: non-Telstra evidence' },
    { device: 'UE Vodafone', result: 'Skipped: non-Telstra evidence' },
    { device: 'UE unknown', result: 'Exact ID', network: 'Telstra (assumed)' },
  ];
  const snapshots = [parseActix(lte, 'actix.csv', '2026-10-13')];
  for (const { device, plmn, result, network = 'Non-Telstra evidence' } of cases) {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Series Formatted Data').addRows([
      ['Time', 'Longitude', 'Latitude', 'LTE_UE_RSRP', 'LTE_Uu_RRC_ECI', 'LTE_UE_PCI', 'LTE_UE_EARFCN_DL', 'Serving_PLMN', 'Nemo_Header_DeviceLabel'],
      ['2026-10-14 08:00:00', 151.61, -32.81, -95, 987, 8, 1725, plmn, device],
      ['2026-10-14 08:00:01', 151.62, -32.82, -99, null, 8, 1725],
    ]);
    const survey = await parseWorkbook(await workbook.xlsx.writeBuffer(), 'Telstra project.xlsx');
    const map = mapFeatures({
      workbooks: [{ survey, tag: 'S1', color: '#000000' }], snapshots, key: 'LTE_UE_RSRP', maxDays: 7,
    });
    assert.deepEqual(map.samples.features.map(({ properties }) => properties.L_MATCH), [result, result], device);
    assert.ok(map.samples.features.every(({ properties }) => properties.NETWORK === network), device);
    if (result !== 'Exact ID') {
      assert.equal(map.sites.features.length, 0, device);
      assert.ok(map.samples.features.every(sample => !sample.siteLinks), device);
    }
  }
});

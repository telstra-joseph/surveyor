import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { closestSnapshot, mapFeatures, parseActix } from '../src/geo.js';
import { makeKml, makeShapefile } from '../src/gis-export.js';
import { applyMapThresholds } from '../src/map-thresholds.js';
import { sectorLegendGroups } from '../src/sector-style.js';
import { parseWorkbook } from '../src/survey.js';

const lte = `SiteID,Latitude,Longitude,Sector_ID,DL_EARFCN,PCI,ECI,Cell_Name
far,-35,153,B,1725,8,987,Far LTE
near,-32.8,151.6,A,1725,8,123,`;

test('groups and deduplicates sector bands without guessing unmapped frequencies', () => {
  const sectors = [
    { rat: 'NR', carrier: 'DA' }, { rat: 'LTE', carrier: 'H' }, { rat: 'NR', carrier: 'V' },
    { rat: 'LTE', carrier: 'H' }, { rat: 'LTE', carrier: 'W' }, { rat: 'NR', carrier: 'X' },
  ];
  assert.deepEqual(sectorLegendGroups(sectors).map(({ rat, entries }) => [rat, entries.map(({ label }) => label)]), [
    ['LTE', ['H 850e MHz', 'W']],
    ['NR', ['V 850 MHz', 'X 2600 MHz', 'D 26000 MHz']],
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
  assert.deepEqual(map.technologyLegend.map(({ label }) => label), ['5', 'LTE', 'LTE-5GNR']);
  const colors = new Map(map.technologyLegend.map(({ label, color }) => [label, color]));
  assert.equal(new Set(colors.values()).size, 3);
  for (const tag of ['S1', 'S2']) {
    const points = map.samples.features.filter(({ properties }) => properties.DEVICE === tag);
    assert.deepEqual(points.map(({ properties }) => [properties.LOG_ROW, properties.CATEGORY, properties.COLOR]),
      ['LTE', 'LTE-5GNR', 'LTE', '5'].map((mode, index) => [index + 1, mode, colors.get(mode)]));
  }
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

test('marks below-threshold readings red without colouring missing or above-range readings red', () => {
  const cases = [
    ['NR_UE_RSRP_0', [-115.01, -115], 'No coverage: < -115 dBm'],
    ['LTE_UE_SINR', [4.99, 5], '< 5 dB'],
    ['NR_UE_SINR_0', [10, 10.01], '≤ 10 dB'],
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
  const above = { properties: { DEVICE: 'S1', VALUE: 5.01 } };
  applyMapThresholds('Speech_MOS_POLQA_Score_DL', [above]);
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

test('maps same-row GPS and distinguishes exact, candidate and unmatched IDs in GIS exports', async () => {
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
    ['Exact ID', '987', 1], ['PCI/channel candidate', '123', 2], ['Unmatched', '', null],
  ]);
  assert.deepEqual(points.map(p => p.L_NAME), ['Far LTE', 'A', '']);
  assert.equal(points[1].L_DAYS, -1);
  assert.deepEqual(map.extent, [-101, -95]);
  assert.equal(map.sites.features.length, 2);
  assert.deepEqual(map.samples.features.map(({ siteLinks }) => siteLinks?.map(({ siteId, exact }) => [
    map.sites.features.find(site => site.id === siteId).geometry.coordinates, exact,
  ])), [[[[153, -35], true]], [[[151.6, -32.8], false]], undefined]);
  assert.deepEqual(map.sectors, []);
  const kml = makeKml(map, 'LTE <survey>');
  assert.match(kml, /LTE &lt;survey&gt;|sample &lt;survey&gt;/);
  assert.match(kml, /<coordinates>151\.62,-32\.82<\/coordinates>/);
  assert.equal(kml.match(/<Placemark>/g).length, 5);
  const zip = Buffer.from(await makeShapefile(map));
  assert.equal(zip.subarray(0, 4).toString('hex'), '504b0304');
  for (const ext of ['shp', 'shx', 'dbf', 'prj']) assert.ok(zip.includes(`survey_points.${ext}`));
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
    assert.deepEqual(map.samples.features.map(({ properties }) => properties.L_MATCH), [
      result, result === 'Exact ID' ? 'PCI/channel candidate' : result,
    ], device);
    assert.ok(map.samples.features.every(({ properties }) => properties.NETWORK === network), device);
    if (result !== 'Exact ID') {
      assert.equal(map.sites.features.length, 0, device);
      assert.ok(map.samples.features.every(sample => !sample.siteLinks), device);
    }
  }
});

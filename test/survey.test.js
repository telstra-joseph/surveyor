import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { binsPerPage, chart, datasets, groupDatasets, legend, samplePoints, sourceTable, toSvg } from '../src/charts.js';
import { makeReport } from '../src/report.js';
import { stackImages } from '../src/image-export.js';
import { parseWorkbook } from '../src/survey.js';

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

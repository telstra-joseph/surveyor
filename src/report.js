import PptxGenJS from 'pptxgenjs';
import { binsPerPage, callDropKey, chart, datasets, deviceName, dropSeriesLegend, isPciKpi, modes, sourceTable, theme } from './charts.js';
import { reportMapLegend, reportMetricName } from './report-labels.js';

const hex = color => color.slice(1);
const slideWidth = 13 + 1 / 3;
const pageHeight = 7.5;
const dateFormat = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function surveyDateLabel(surveys) {
  const days = [...new Set(surveys.flatMap(survey => survey.days || []))].sort();
  if (!days.length) return 'Log date not recorded';
  const first = new Date(days[0]);
  return days.length === 1 ? dateFormat.format(first) : dateFormat.formatRange(first, new Date(days.at(-1)));
}

export async function makeReport({ location, surveys, keys, maps = [], sections }, onProgress) {
  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE';
  deck.title = `${location} Network Survey`;
  deck.lang = 'en-AU';
  deck.theme = { headFontFace: theme.display, bodyFontFace: theme.font, lang: 'en-AU' };
  const addText = (slide, value, options) => slide.addText(value, {
    margin: 0, fontFace: theme.font, color: hex(theme.ink), fontSize: 14, ...options,
  });
  const shape = (slide, type, color, options) => slide.addShape(deck.ShapeType[type], {
    fill: { color: hex(color) }, line: { transparency: 100 }, ...options,
  });
  let sectionTitle = sections ? 'Title' : undefined;
  if (sectionTitle) deck.addSection({ title: sectionTitle });
  const cover = deck.addSlide({ sectionTitle });
  cover.background = { color: hex(theme.cream) };
  shape(cover, 'rect', theme.navy, { x: 8.15, y: 0, w: slideWidth - 8.15, h: pageHeight });
  shape(cover, 'ellipse', theme.blue, { x: 8.85, y: 1.65, w: 3.65, h: 3.65 });
  shape(cover, 'ellipse', theme.coral, { x: 10.77, y: 4.65, w: 1.7, h: 1.7 });
  addText(cover, `${location}\nNetwork Survey`, {
    x: .52, y: 2.92, w: 7.05, h: 1.75, fontFace: theme.display, fontSize: 40, fit: 'shrink',
  });
  addText(cover, surveyDateLabel(surveys), { x: .52, y: 5.21, w: 6.7, h: .38, fontSize: 16 });

  let slideNumber = 1;
  const addDivider = title => {
    const slide = deck.addSlide({ sectionTitle });
    slideNumber++;
    slide.background = { color: hex(theme.navy) };
    shape(slide, 'rect', theme.coral, { x: .54, y: 2.45, w: .75, h: .07 });
    addText(slide, title, { x: .54, y: 2.75, w: 12.25, h: 1.5, color: hex(theme.paper),
      fontFace: theme.display, fontSize: 42, fit: 'shrink' });
  };
  const addPage = (title, subtitle) => {
    const slide = deck.addSlide({ sectionTitle });
    slide.background = { color: hex(theme.paper) };
    addText(slide, title, { x: .52, y: .42, w: 12.25, h: .6, fontFace: theme.display, fontSize: 31, fit: 'shrink' });
    if (subtitle) addText(slide, subtitle, { x: .52, y: 1.04, w: 12.25, h: .34, color: hex(theme.muted), fontSize: 16, fit: 'shrink' });
    shape(slide, 'rect', theme.grid, { x: .52, y: 6.97, w: 12.3, h: .012 });
    addText(slide, `Page ${++slideNumber}`, { x: .52, y: 7.06, w: .95, h: .2, fontSize: 9 });
    addText(slide, location, { x: 8.8, y: 7.06, w: 4, h: .2, align: 'right', fontSize: 9, fit: 'shrink' });
    return slide;
  };

  const addGroupPages = (title, mode, items, groupLabel, dropSeries) => {
    const rows = mode === 'series' ? [] : sourceTable(items);
    const pages = Math.max(1, Math.ceil(rows.length / binsPerPage));
    const entries = dropSeries ? dropSeriesLegend(items) : items;
    for (let page = 0; page < pages; page++) {
      const subtitle = `${modes[mode]}${groupLabel}${pages > 1 ? ` | ${page + 1} of ${pages}` : ''}`;
      const slide = addPage(title, subtitle);
      if (mode === 'statistics') {
        slide.addTable([['Statistic', ...items.map(item => item.tag)], ...rows.slice(page * binsPerPage, (page + 1) * binsPerPage)
          .map(({ label, values }) => [label, ...values.map(value => String(value ?? 'Not reported'))])], {
          x: .58, y: 1.85, w: 9, fontFace: theme.font, fontSize: 10, autoPage: false, border: { color: hex(theme.grid), pt: .6 },
        });
      } else {
        const plot = chart(title, mode, items, page);
        const scale = 9.2 / plot.width;
        const x0 = .54, y0 = 1.54;
        for (const mark of plot.marks) {
          const x = x0 + mark.x * scale, y = y0 + mark.y * scale;
          if (mark.kind === 'text') {
            const centeredWidth = Math.max(1.05, mark.value.length * mark.size * scale * .6);
            const w = mark.align === 'right' ? .92 : mark.align === 'center' ? centeredWidth : 8;
            const offset = mark.align === 'right' ? w : mark.align === 'center' ? w / 2 : 0;
            addText(slide, mark.value, { x: x - offset, y: y - .1, w, h: .2, fontSize: mark.size * scale * 72, align: mark.align, color: hex(mark.color) });
          } else {
            shape(slide, mark.kind === 'dot' ? 'ellipse' : 'rect', mark.color, { x, y, w: mark.w * scale, h: mark.h * scale });
          }
        }
        addText(slide, dropSeries
          ? entries.length ? 'Each dot marks a detected call drop.' : 'No call drops detected in this workbook group.'
          : mode === 'histogram'
          ? 'Workbook counts: a missing bin is not a reported zero.'
          : 'Each dot represents a recorded value. Workbook rows are not aligned in time.', {
          x: .5, y: 5.74, w: 9, h: .28, fontSize: 11,
        });
      }
      if (!entries.length) continue;
      addText(slide, 'Legend', { x: 10.0, y: 1.72, w: 2.7, h: .35, fontFace: theme.display, fontSize: 16 });
      slide.addTable(entries.map(({ tag, name, color, label }) => [
        { text: '', options: { fill: { color: hex(color) } } }, ...(dropSeries ? [label] : [tag, name]),
      ]), {
        x: 10.0, y: 2.17, colW: dropSeries ? [.2, 2.6] : [.2, .6, 2.0], rowH: .35, margin: .06,
        fontFace: theme.font, fontSize: 10, color: hex(theme.ink),
        fill: { color: hex(theme.cream) }, border: { color: hex(theme.paper), pt: .6 }, autoPage: false,
      });
    }
  };

  const addMapPage = (title, map, groupLabel) => {
    const subtitle = groupLabel.replace(/^ \| /, '');
    const slide = addPage(title, subtitle);
    const { title: legendTitle, entries } = reportMapLegend(map.key, map.legend);
    const rowsPerMapColumn = 16, legendColumnWidth = 2.58, columnGap = .12;
    const twoColumns = isPciKpi(map.key) && entries.length > rowsPerMapColumn;
    const legendWidth = twoColumns ? 2 * legendColumnWidth + columnGap : legendColumnWidth;
    const legendX = 12.78 - legendWidth;
    const area = { x: .54, y: subtitle ? 1.48 : 1.2, w: legendX - .70 };
    area.h = 6.84 - area.y;
    const scale = Math.min(area.w / map.width, area.h / map.height);
    const w = map.width * scale, h = map.height * scale;
    const x = area.x + (area.w - w) / 2, y = area.y + (area.h - h) / 2;
    slide.addImage({ data: map.image, x, y, w, h, altText: `${title} survey map` });
    const addLegendTable = (page, entries, x, y, width) => {
      page.addTable(entries.map(({ label, color, shape: swatchShape }) => [
        { text: '', options: swatchShape === 'circle' ? {} : { fill: { color: hex(color) } } }, label,
      ]), {
        x, y, colW: [.2, width - .2], rowH: .25, margin: .03, fontFace: theme.font, fontSize: 10,
        color: hex(theme.ink), fill: { color: hex(theme.cream) },
        border: { color: hex(theme.paper), pt: .6 }, autoPage: false,
      });
      entries.forEach(({ color, shape: swatchShape }, index) => {
        if (swatchShape === 'circle') shape(page, 'ellipse', color, { x: x + .03, y: y + index * .25 + .055, w: .14, h: .14 });
      });
    };
    const onMap = rowsPerMapColumn * (twoColumns ? 2 : 1), perColumn = 18, perSlide = perColumn * 3;
    addText(slide, legendTitle, { x: legendX, y: 1.49, w: legendWidth, h: .35, fontFace: theme.display, fontSize: 16, fit: 'shrink' });
    if (entries.length) addLegendTable(slide, entries.slice(0, rowsPerMapColumn), legendX, 1.89, legendColumnWidth);
    if (twoColumns) addLegendTable(slide, entries.slice(rowsPerMapColumn, onMap), legendX + legendColumnWidth + columnGap, 1.89, legendColumnWidth);
    if (entries.length > onMap) addText(slide, `+${entries.length - onMap} values on following slides`, {
      x: legendX, y: 6.13, w: legendWidth, h: .2, fontSize: 9,
    });
    if (!map.plan && map.attribution) {
      const inset = Math.min(.06, w / 8, h / 8);
      const creditHeight = Math.min(.16, h - 2 * inset);
      const creditWidth = Math.min(w - 2 * inset, map.attribution.length * .1 + 2 * inset);
      const fontSize = Math.min(7, (creditWidth - inset) * 72 / map.attribution.length, creditHeight * 54);
      addText(slide, map.attribution, {
        x: x + w - creditWidth - inset, y: y + h - creditHeight - inset, w: creditWidth, h: creditHeight,
        fontSize, align: 'right', valign: 'mid', wrap: false, fit: 'shrink', margin: [0, inset * 36, 0, inset * 36],
        fill: { color: hex(theme.paper) },
      });
    } else if (!map.plan && map.missingBasemap) {
      addText(slide, 'Basemap unavailable', { x: .54, y: 6.82, w: 2, h: .14, fontSize: 8 });
    }
    for (let start = onMap; start < entries.length; start += perSlide) {
      const end = Math.min(start + perSlide, entries.length);
      const page = addPage(title, `${legendTitle}${groupLabel} | Values ${start + 1}–${end} of ${entries.length}`);
      for (let index = start; index < end; index += perColumn) {
        addLegendTable(page, entries.slice(index, Math.min(index + perColumn, end)), .54 + 4.1 * (index - start) / perColumn, 1.65, 3.95);
      }
    }
  };

  let completed = 0;
  const total = keys.length * (sections?.length ?? 1);
  const addKpiPages = (key, workbookIndexes, sectionLabel = '') => {
    const title = reportMetricName(key);
    const mapsByWorkbook = new Map(maps.filter(map => map.key === key).map(map => [map.workbookIndex, map]));
    const workbooks = workbookIndexes.map(index => surveys[index]);
    const chartsByWorkbook = new Map();
    for (const mode of key === callDropKey ? ['series', 'histogram', 'statistics'] : ['histogram', 'series', 'statistics']) {
      for (const item of datasets(workbooks, key, mode)) {
        if (!chartsByWorkbook.has(item.index)) chartsByWorkbook.set(item.index, { mode, item });
      }
    }
    workbookIndexes.forEach((workbookIndex, index) => {
      const workbook = workbooks[index];
      const label = ` | S${(workbook.sourceIndex ?? workbookIndex) + 1} ${deviceName(workbook)}${sectionLabel}`;
      const map = mapsByWorkbook.get(workbookIndex);
      if (map) addMapPage(title, map, map.plan && !sectionLabel ? `${label} | Floor plan: ${map.plan}` : label);
      else {
        const chart = chartsByWorkbook.get(index);
        if (chart) addGroupPages(title, chart.mode, [chart.item], label, key === callDropKey && chart.mode === 'series');
      }
    });
    onProgress?.(++completed, total);
  };
  if (sections) {
    for (const [index, { title, workbookIndexes, dividerTitle }] of sections.entries()) {
      // PptxGenJS assigns slides by title, so keep names unique until all slides are assigned.
      sectionTitle = `${index + 1}. ${title}`;
      deck.addSection({ title: sectionTitle });
      if (dividerTitle) addDivider(dividerTitle);
      const before = slideNumber;
      for (const key of keys) {
        addKpiPages(key, workbookIndexes, ` | ${title}`);
      }
      if (slideNumber === before) addPage(title, 'No data for the selected KPIs');
    }
    sections.forEach(({ title }, index) => { deck.sections[index + 1].title = title; });
  } else {
    const workbookIndexes = surveys.map((_, index) => index);
    for (const key of keys) addKpiPages(key, workbookIndexes);
  }
  return deck.write({ outputType: 'arraybuffer', compression: true });
}

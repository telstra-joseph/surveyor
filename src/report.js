import PptxGenJS from 'pptxgenjs';
import { binsPerPage, chart, datasets, groupDatasets, metricName, modes, sourceTable, theme } from './charts.js';

const hex = color => color.slice(1);
const slideWidth = 13 + 1 / 3;
const pageHeight = 7.5;

export async function makeReport({ location, surveys, keys }) {
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
  const cover = deck.addSlide();
  cover.background = { color: hex(theme.cream) };
  shape(cover, 'rect', theme.navy, { x: 8.15, y: 0, w: slideWidth - 8.15, h: pageHeight });
  shape(cover, 'ellipse', theme.blue, { x: 8.85, y: 1.65, w: 3.65, h: 3.65 });
  shape(cover, 'ellipse', theme.coral, { x: 10.77, y: 4.65, w: 1.7, h: 1.7 });
  addText(cover, `${location}\nNetwork Survey`, {
    x: .52, y: 2.92, w: 7.05, h: 1.75, fontFace: theme.display, fontSize: 40, fit: 'shrink',
  });
  addText(cover, `${surveys.length} workbooks  /  ${keys.length} KPIs`, { x: .52, y: 5.21, w: 6.7, h: .38, fontSize: 16 });

  let slideNumber = 1;
  const addPage = (title, subtitle) => {
    const slide = deck.addSlide();
    slide.background = { color: hex(theme.paper) };
    addText(slide, title, { x: .52, y: .42, w: 12.25, h: .6, fontFace: theme.display, fontSize: 31, fit: 'shrink' });
    addText(slide, subtitle, { x: .52, y: 1.04, w: 12.25, h: .34, color: hex(theme.muted), fontSize: 16 });
    shape(slide, 'rect', theme.grid, { x: .52, y: 6.97, w: 12.3, h: .012 });
    addText(slide, `Page ${++slideNumber}`, { x: .52, y: 7.06, w: .95, h: .2, fontSize: 9 });
    addText(slide, location, { x: 8.8, y: 7.06, w: 4, h: .2, align: 'right', fontSize: 9, fit: 'shrink' });
    return slide;
  };

  const addGroupPages = (title, mode, items, groupLabel) => {
    const rows = mode === 'series' ? [] : sourceTable(items);
    const pages = Math.max(1, Math.ceil(rows.length / binsPerPage));
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
        addText(slide, mode === 'histogram'
          ? 'Workbook counts: a missing bin is not a reported zero.'
          : 'Each dot represents a recorded value. Workbook rows are not aligned in time.', {
          x: .5, y: 5.74, w: 9, h: .28, fontSize: 11,
        });
      }
      addText(slide, 'Legend', { x: 10.0, y: 1.72, w: 2.7, h: .35, fontFace: theme.display, fontSize: 16 });
      slide.addTable(items.map(({ tag, name, color }) => [
        { text: '', options: { fill: { color: hex(color) } } }, tag, name,
      ]), {
        x: 10.0, y: 2.17, colW: [.2, .6, 2.0], rowH: .35, margin: .06,
        fontFace: theme.font, fontSize: 10, color: hex(theme.ink),
        fill: { color: hex(theme.cream) }, border: { color: hex(theme.paper), pt: .6 }, autoPage: false,
      });
    }
  };
  for (const key of keys) {
    const title = metricName(key);
    for (const mode of ['histogram', 'series', 'statistics']) {
      const groups = groupDatasets(datasets(surveys, key, mode));
      if (!groups.length) continue;
      groups.forEach((items, index) => {
        const label = groups.length > 1 ? ` | Workbook group ${index + 1} of ${groups.length}` : '';
        addGroupPages(title, mode, items, label);
      });
      break;
    }
  }
  return deck.write({ outputType: 'arraybuffer', compression: true });
}

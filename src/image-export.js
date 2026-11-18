import { escapeMarkup, theme } from './charts.js';

export function imageSvg({ title, width, height, content }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeMarkup(title)}"><title>${escapeMarkup(title)}</title><rect width="100%" height="100%" fill="${theme.paper}"/>${content}</svg>`;
}

export function stackImages(title, ...images) {
  const width = Math.max(...images.map(image => image.width));
  let height = 0;
  const content = images.map(({ svg, width: partWidth, height: partHeight }) => {
    const part = `<g transform="translate(${(width - partWidth) / 2} ${height})">${svg}</g>`;
    height += partHeight + 12;
    return part;
  }).join('');
  return imageSvg({ title, width, height: height - 12, content });
}

export function mapImage(element, title) {
  const viewport = element.getBoundingClientRect();
  const width = Math.round(element.clientWidth), height = Math.round(element.clientHeight);
  if (!width || !height) throw new Error('Open the map before exporting it.');
  const originX = viewport.left + element.clientLeft, originY = viewport.top + element.clientTop;
  const bounds = node => {
    const { left, top, width, height } = node.getBoundingClientRect();
    return { x: left - originX, y: top - originY, w: width, h: height };
  };
  const withinViewport = ({ x, y, w, h }) => x < width && y < height && x + w > 0 && y + h > 0;
  const xml = new XMLSerializer();
  const layers = [
    '.actix-sector svg', '.leaflet-overlay-pane :is(canvas, svg)', '.actix-site-centre svg', '.actix-site-label span',
  ].flatMap(selector => [...element.querySelectorAll(selector)]).map(node => {
    const area = bounds(node);
    if (!withinViewport(area)) return '';
    const { x, y, w, h } = area;
    if (node instanceof HTMLCanvasElement) return `<image x="${x}" y="${y}" width="${w}" height="${h}" href="${node.toDataURL()}"/>`;
    if (node instanceof SVGSVGElement) {
      const copy = node.cloneNode(true);
      return `<g transform="translate(${x} ${y})">${xml.serializeToString(copy)}</g>`;
    }
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="white"/><text x="${x + 5}" y="${y + h / 2}" dominant-baseline="central" fill="${theme.ink}" font-family="${theme.font}, Arial, sans-serif" font-size="12" font-weight="700">${escapeMarkup(node.textContent)}</text>`;
  });
  const content = `<rect width="100%" height="100%" fill="#E6ECED"/>${layers.join('')}`;
  return { width, height, svg: imageSvg({ title, width, height, content }) };
}

export async function svgImage(svg, format) {
  const vector = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  if (format === 'svg') return vector;
  const mime = { png: 'image/png', jpg: 'image/jpeg' }[format];
  if (!mime) throw new Error('Unknown image format.');
  const url = URL.createObjectURL(vector);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth * 2;
    canvas.height = image.naturalHeight * 2;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot render the image.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, 0.94));
    if (!blob || blob.type !== mime) throw new Error('This browser cannot export the selected format.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

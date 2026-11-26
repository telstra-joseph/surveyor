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

export function mapImage(element, title, includeTiles = false, { cropToFloorPlan } = {}) {
  const viewport = element.getBoundingClientRect();
  const width = Math.round(element.clientWidth), height = Math.round(element.clientHeight);
  if (!width || !height) throw new Error('Open the map before exporting it.');
  const originX = viewport.left + element.clientLeft, originY = viewport.top + element.clientTop;
  const bounds = node => {
    const { left, top, width, height } = node.getBoundingClientRect();
    return { x: left - originX, y: top - originY, w: width, h: height };
  };
  const overlaps = (area, { x, y, w, h }) => area.x < x + w && area.y < y + h && area.x + area.w > x && area.y + area.h > y;
  const screen = { x: 0, y: 0, w: width, h: height };
  const planImage = cropToFloorPlan === false ? null : element.querySelector('img.survey-floor-plan');
  if (cropToFloorPlan && !planImage) throw new Error('The floor plan is not available for capture.');
  const planBounds = planImage && bounds(planImage);
  if (planBounds && (!planBounds.w || !planBounds.h)) throw new Error('The floor plan has no visible bounds.');
  const withinViewport = area => overlaps(area, screen);
  const bearing = Number(element.dataset.bearing) || 0;
  // Map-aligned layers are measured with the rotating pane briefly unrotated, then drawn through its transform.
  const rotatePane = bearing ? element.querySelector('.leaflet-rotate-pane') : null;
  let paneMatrix = null, region = screen;
  if (rotatePane) {
    const style = getComputedStyle(rotatePane);
    const transform = new DOMMatrix(style.transform === 'none' ? undefined : style.transform);
    const [ox, oy] = style.transformOrigin.split(' ').map(parseFloat);
    const saved = rotatePane.style.transform;
    rotatePane.style.transform = 'none';
    const { x, y } = bounds(rotatePane);
    paneMatrix = new DOMMatrix().translate(x + ox, y + oy).multiply(transform).translate(-x - ox, -y - oy);
    const inverse = paneMatrix.inverse();
    const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([px, py]) => inverse.transformPoint({ x: px, y: py }));
    const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
    region = { x: Math.floor(Math.min(...xs)), y: Math.floor(Math.min(...ys)) };
    region.w = Math.ceil(Math.max(...xs)) - region.x;
    region.h = Math.ceil(Math.max(...ys)) - region.y;
    try {
      return composeMap();
    } finally {
      rotatePane.style.transform = saved;
    }
  }
  return composeMap();

  function composeMap() {
    const inRegion = area => overlaps(area, region);
    let basemap = '', attribution = '';
    if (includeTiles) {
      const tiles = [...element.querySelectorAll('.leaflet-tile-pane img.leaflet-tile')]
        .map(node => ({ node, area: bounds(node) })).filter(({ area }) => inRegion(area));
      if (tiles.length && tiles.every(({ node }) => node.complete && node.naturalWidth && node.classList.contains('leaflet-tile-loaded'))) {
        const canvas = document.createElement('canvas');
        canvas.width = region.w;
        canvas.height = region.h;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser cannot capture the basemap.');
        for (const { node, area: { x, y, w, h } } of tiles) context.drawImage(node, x - region.x, y - region.y, w, h);
        basemap = `<image x="${region.x}" y="${region.y}" width="${region.w}" height="${region.h}" href="${canvas.toDataURL()}"/>`;
        attribution = element.querySelector('.leaflet-control-attribution')?.textContent.trim() || '';
      }
    }
    const xml = new XMLSerializer();
    const plans = [...element.querySelectorAll('.leaflet-pane img.survey-floor-plan')].map(node => {
      const transform = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      const pane = node.parentElement.getBoundingClientRect();
      const { a, b, c, d, e, f } = transform;
      const matrix = [a, b, c, d, e + pane.left - originX, f + pane.top - originY].map(value => +value.toFixed(6));
      const opacity = +getComputedStyle(node).opacity;
      return `<image width="${node.width}" height="${node.height}" preserveAspectRatio="none" transform="matrix(${matrix.join(' ')})"${opacity < 1 ? ` opacity="${opacity}"` : ''} href="${escapeMarkup(node.src)}"/>`;
    }).join('');
    const actix = within => node => {
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden') return '';
      const area = bounds(node);
      if (!within(area)) return '';
      const { x, y, w, h } = area;
      const opacity = style.opacity;
      if (node instanceof SVGSVGElement) {
        const copy = node.cloneNode(true);
        copy.setAttribute('width', w);
        copy.setAttribute('height', h);
        return `<g transform="translate(${x} ${y})" opacity="${opacity}">${xml.serializeToString(copy)}</g>`;
      }
      return `<g opacity="${opacity}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="white"/><text x="${x + 5}" y="${y + h / 2}" dominant-baseline="central" fill="${theme.ink}" font-family="${theme.font}, Arial, sans-serif" font-size="12" font-weight="700">${escapeMarkup(node.textContent)}</text></g>`;
    };
    const sectors = [...element.querySelectorAll('.actix-sector svg')].map(actix(inRegion)).join('');
    const overlays = [...element.querySelectorAll('.leaflet-overlay-pane :is(canvas, svg)')].map(node => {
      const area = bounds(node);
      if (!inRegion(area)) return '';
      const { x, y, w, h } = area;
      if (node instanceof HTMLCanvasElement) return `<image x="${x}" y="${y}" width="${w}" height="${h}" href="${node.toDataURL()}"/>`;
      return `<g transform="translate(${x} ${y})">${xml.serializeToString(node.cloneNode(true))}</g>`;
    }).join('');
    // Site markers and labels stay upright, so they are measured and drawn in screen space.
    const upright = [...element.querySelectorAll('.actix-site-centre svg, .actix-site-label span')].map(actix(withinViewport)).join('');
    const aligned = `${basemap}${plans}${sectors}${overlays}`;
    const rotated = paneMatrix ? `<g transform="matrix(${['a', 'b', 'c', 'd', 'e', 'f'].map(key => +paneMatrix[key].toFixed(6)).join(' ')})">${aligned}</g>` : aligned;
    const paper = element.classList.contains('floor-plan-basemap') ? '#FFFFFF' : '#E6ECED';
    let cropX = 0, cropY = 0, outputWidth = width, outputHeight = height;
    if (planBounds) {
      const paddedWidth = planBounds.w + 8, paddedHeight = planBounds.h + 8;
      const sourceWidth = planImage.naturalWidth || planImage.width;
      const sourceHeight = planImage.naturalHeight || planImage.height;
      const ratio = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : paddedWidth / paddedHeight;
      outputWidth = Math.max(paddedWidth, paddedHeight * ratio);
      outputHeight = outputWidth / ratio;
      cropX = planBounds.x + (planBounds.w - outputWidth) / 2;
      cropY = planBounds.y + (planBounds.h - outputHeight) / 2;
    }
    const layers = planBounds ? `<g transform="translate(${-cropX} ${-cropY})">${rotated}${upright}</g>` : `${rotated}${upright}`;
    const content = `<rect width="100%" height="100%" fill="${paper}"/>${layers}`;
    return { width: outputWidth, height: outputHeight, svg: imageSvg({ title, width: outputWidth, height: outputHeight, content }), hasBasemap: Boolean(basemap), attribution };
  }
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

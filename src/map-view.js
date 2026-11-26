import L from './leaflet-global.js';
import 'leaflet-rotate';
import 'leaflet/dist/leaflet.css';
import { escapeMarkup, format, metricName } from './charts.js';
import { layoutSectors, sectorKey, sectorColor, siteSectorKey } from './sector-style.js';

const env = import.meta.env;
const provider = (url, attribution, fallback) => {
  if (!url && !attribution) return fallback;
  const valid = url && (/^https:\/\//i.test(url) || /^\/(?![\\/])/.test(url)) && /\{z\}/.test(url) &&
    /\{x\}/.test(url) && /\{y\}/.test(url);
  return valid && attribution?.trim() ? { url, attribution: escapeMarkup(attribution) } : null;
};
const gibs = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const nasa = '<a href="https://www.earthdata.nasa.gov/data/tools/gibs" target="_blank" rel="noopener noreferrer">NASA EOSDIS GIBS</a>';
const street = provider(env.VITE_STREET_TILE_URL, env.VITE_STREET_TILE_ATTRIBUTION, {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
  maxNativeZoom: 19,
});
const satellite = provider(env.VITE_SATELLITE_TILE_URL, env.VITE_SATELLITE_TILE_ATTRIBUTION, {
  url: `${gibs}/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`,
  attribution: `Blue Marble, ${nasa}`,
  maxNativeZoom: 8,
});
const labels = provider(env.VITE_LABELS_TILE_URL, env.VITE_LABELS_TILE_ATTRIBUTION, {
  url: `${gibs}/Reference_Labels_15m/default/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`,
  attribution: `Reference labels, ${nasa}`,
  maxNativeZoom: 13,
});
const sources = { local: [], street: street && [street], satellite: satellite && [satellite], hybrid: satellite && labels && [satellite, labels] };

export function cellDescription(props, prefix) {
  const get = field => props[`${prefix}_${field}`];
  return [get('MATCH'), get('DATE') && `snapshot ${get('DATE')} (${get('DAYS')} d)`,
    get('CELL') && `cell ${get('CELL')}`, get('SITE') && `site ${get('SITE')}`,
    get('COUNT') > 1 && `${get('COUNT')} matches`, get('KM') != null && `${get('KM')} km`].filter(Boolean).join(' · ');
}

const sampleValue = ({ CATEGORY, VALUE }) => CATEGORY || (VALUE == null ? 'No reading for this KPI' : format(VALUE));

function samplePopup(props) {
  const popup = document.createElement('dl');
  const details = props.KIND === 'Actix cell' ? {
    Network: props.RAT, 'Snapshot date': props.SNAPSHOT, Cell: props.CELL_ID, Site: props.SITE_ID, Sector: props.SECTOR, Match: props.MATCH,
  } : {
    Workbook: props.WORKBOOK, Device: props.DEVICE, 'Log row': props.LOG_ROW, 'Survey date': props.SURVEYDAY,
    Network: props.NETWORK,
    Value: sampleValue(props),
    ...(props.KPI_BAND ? { 'KPI band': props.KPI_BAND } : {}),
    ...(props.L_NAME ? { 'LTE association': props.L_NAME } : {}),
    ...(props.N_NAME ? { 'NR association': props.N_NAME } : {}),
  };
  for (const [label, value] of Object.entries(details)) {
    const key = document.createElement('dt'), text = document.createElement('dd');
    key.textContent = label;
    text.textContent = value || 'Not reported';
    popup.append(key, text);
  }
  return popup;
}

const siteCentreIcon = L.divIcon({ className: 'actix-site-centre', iconSize: [11, 11], iconAnchor: [5.5, 5.5],
  html: '<svg viewBox="0 0 11 11" width="11" height="11" aria-hidden="true"><circle cx="5.5" cy="5.5" r="4.5" fill="#FFF1B6" fill-opacity=".8" stroke="#833C1C" stroke-width="2" stroke-dasharray="3 3"/></svg>' });

function sectorOffset(angle, radius) {
  const radians = angle * Math.PI / 180;
  return L.point(radius * Math.sin(radians), -radius * Math.cos(radians));
}

// Sector symbols sit in the rotating pane, so they turn with the map without the plugin's upright repositioning.
const SectorMarker = L.Marker.extend({
  _setPos(pos) {
    L.DomUtil.setPosition(this._icon, pos);
    this._zIndex = pos.y + this.options.zIndexOffset;
    this._resetZIndex();
  },
});

function sectorIcon(sector) {
  const { rat, azimuth, beamwidth, inner, radius } = sector;
  const color = sectorColor(sector);
  const half = Math.ceil(radius) + 3, size = 2 * half;
  const edge = (angle, distance) => {
    const { x, y } = sectorOffset(angle, distance);
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  };
  const start = azimuth - beamwidth / 2, end = azimuth + beamwidth / 2, large = beamwidth > 180 ? 1 : 0;
  const ring = r => `M${-r} 0 A${r} ${r} 0 1 1 ${r} 0 A${r} ${r} 0 1 1 ${-r} 0 Z`;
  const path = beamwidth === 360 ? `${ring(radius)} ${inner ? ring(inner) : ''}`
    : `M${edge(start, radius)} A${radius} ${radius} 0 ${large} 1 ${edge(end, radius)}`
      + (inner ? ` L${edge(end, inner)} A${inner} ${inner} 0 ${large} 0 ${edge(start, inner)} Z` : ' L0 0 Z');
  return L.divIcon({ className: `actix-sector actix-sector-${rat.toLowerCase()}`,
    html: `<svg viewBox="${-half} ${-half} ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><path d="${path}" fill="none" stroke="#131A35" stroke-width="3"/><path d="${path}" fill="${color}" fill-opacity="${sector.pciColor ? 1 : .56}" fill-rule="evenodd" stroke="${color}" stroke-width="1.5"/></svg>`,
    iconSize: [size, size] });
}

function siteLabels({ features }) {
  const seen = new Set();
  return features.flatMap(({ geometry: { coordinates }, properties: { SITE_ID } }) => {
    if (!SITE_ID) return [];
    const key = JSON.stringify([SITE_ID, coordinates]);
    if (seen.has(key)) return [];
    seen.add(key);
    const text = document.createElement('span');
    text.textContent = SITE_ID;
    const icon = L.divIcon({ className: 'actix-site-label', html: text, iconSize: [0, 0] });
    const marker = L.marker(L.GeoJSON.coordsToLatLng(coordinates), { icon, interactive: false, keyboard: false });
    return [{ marker, text, key: JSON.stringify(coordinates) }];
  });
}

const sampleRadius = 5;

// Draws a floor-plan image through its three georeferenced corners, including rotation and skew.
const FloorPlanLayer = L.Layer.extend({
  initialize(plan) {
    this.plan = plan;
  },
  onAdd(map) {
    const { image, imageWidth, imageHeight, name } = this.plan;
    const img = this.image = L.DomUtil.create('img', 'survey-floor-plan leaflet-zoom-hide', map.getPane('floor-plan'));
    img.alt = `${name} floor plan`;
    img.draggable = false;
    img.width = imageWidth;
    img.height = imageHeight;
    img.src = image;
    map.on('zoomend viewreset rotate', this.update, this);
    this.update();
  },
  onRemove(map) {
    map.off('zoomend viewreset rotate', this.update, this);
    this.image.remove();
  },
  update() {
    const { corners, imageWidth: width, imageHeight: height } = this.plan;
    const [origin, right, down] = corners.map(point => this._map.latLngToLayerPoint(L.GeoJSON.coordsToLatLng(point)));
    const matrix = [(right.x - origin.x) / width, (right.y - origin.y) / width, (down.x - origin.x) / height,
      (down.y - origin.y) / height, origin.x, origin.y];
    this.image.style.transform = `matrix(${matrix.join(',')})`;
  },
});

const normalBearing = degrees => Math.round(((degrees % 360) + 360) % 360 * 10) / 10 % 360;

// Bearing that turns the floor plan's top edge horizontal, keeping the plan the right way up.
function alignedBearing({ x: x1, y: y1 }, { x: x2, y: y2 }) {
  return normalBearing(-Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI);
}

const rotationIcons = {
  left: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 4v6h6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 15a7.5 7.5 0 1 0 1.8-7.8L4 10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  right: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 4v6h-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 15a7.5 7.5 0 1 1-1.8-7.8L20 10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  north: '<svg class="map-rotate-needle" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2.12"/><path d="M12 3.5l4 8.5h-8z" fill="var(--issue-ink)"/><path d="M12 20.5l-4-8.5h8z" fill="currentColor"/></svg>',
  plan: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="4" y="6" width="16" height="12" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 3h20" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/></svg>',
};

const RotationControl = L.Control.extend({
  options: { position: 'topleft', step: 15 },
  initialize(view, options) {
    L.setOptions(this, options);
    this.view = view;
  },
  onAdd(map) {
    const container = L.DomUtil.create('div', 'leaflet-bar map-rotate-control');
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', 'Map rotation');
    const button = (icon, label, title, action) => {
      const control = L.DomUtil.create('button', 'map-rotate-button', container);
      control.type = 'button';
      control.innerHTML = icon;
      control.setAttribute('aria-label', label);
      control.title = title;
      L.DomEvent.on(control, 'click', event => {
        L.DomEvent.stop(event);
        action(event);
      });
      return control;
    };
    const turn = direction => event => this.view.setBearing(map.getBearing() + direction * (event.shiftKey ? 1 : this.options.step));
    button(rotationIcons.left, `Rotate map ${this.options.step}° anticlockwise`, `Rotate ${this.options.step}° anticlockwise (Shift: 1°)`, turn(-1));
    this.north = L.DomUtil.create('div', 'map-rotate-button map-rotate-compass', container);
    this.north.tabIndex = 0;
    this.north.setAttribute('role', 'slider');
    this.north.setAttribute('aria-label', 'Map rotation');
    this.north.setAttribute('aria-valuemin', '0');
    this.north.setAttribute('aria-valuemax', '359.9');
    this.north.setAttribute('aria-keyshortcuts', 'Home');
    this.north.innerHTML = rotationIcons.north;
    this.north.append(this.value = L.DomUtil.create('span', 'map-rotate-value'));
    this.compass(map);
    button(rotationIcons.right, `Rotate map ${this.options.step}° clockwise`, `Rotate ${this.options.step}° clockwise (Shift: 1°)`, turn(1));
    this.align = button(rotationIcons.plan, 'Align map to floor plan', 'Align to floor plan', () => this.view.alignToFloorPlan());
    this.status = L.DomUtil.create('span', 'visually-hidden', container);
    this.status.setAttribute('aria-live', 'polite');
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    this.update();
    return container;
  },
  // Compass dial: drag around it to turn the map freely (like Google Earth), select it to reset north up.
  compass(map) {
    const dial = this.north;
    const angle = (event, { x, y }) => Math.atan2(event.clientY - y, event.clientX - x) * 180 / Math.PI;
    let drag, dragged = false;
    const end = event => {
      if (!drag || event.pointerId !== drag.id) return;
      dragged = drag.moved;
      drag = undefined;
      dial.classList.remove('is-dragging');
    };
    L.DomEvent.on(dial, {
      pointerdown: event => {
        if (event.button !== 0) return;
        L.DomEvent.stop(event);
        const { left, top, width, height } = dial.getBoundingClientRect();
        const centre = { x: left + width / 2, y: top + height / 2 };
        drag = { id: event.pointerId, centre, lastAngle: angle(event, centre), bearing: map.getBearing(), x: event.clientX, y: event.clientY, moved: false };
        dial.setPointerCapture(event.pointerId);
        dial.focus();
      },
      pointermove: event => {
        if (!drag || event.pointerId !== drag.id) return;
        if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
        drag.moved = true;
        dial.classList.add('is-dragging');
        const nextAngle = angle(event, drag.centre);
        // Use the shortest step across the ±180° seam, then apply half the pointer rotation.
        drag.bearing += ((nextAngle - drag.lastAngle + 540) % 360 - 180) / 2;
        drag.lastAngle = nextAngle;
        this.view.setBearing(drag.bearing);
      },
      pointerup: end,
      pointercancel: end,
      click: event => {
        L.DomEvent.stop(event);
        if (dragged) dragged = false;
        else this.view.setBearing(0);
      },
      keydown: event => {
        const steps = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 15, PageDown: -15 };
        if (event.key === 'Home' || event.key === 'Enter') this.view.setBearing(0);
        else if (steps[event.key]) {
          const step = steps[event.key];
          this.view.setBearing(map.getBearing() + (event.shiftKey && Math.abs(step) === 1 ? step / 10 : step));
        } else return;
        L.DomEvent.stop(event);
      },
    });
  },
  update(announce = false) {
    if (!this.value) return;
    const bearing = normalBearing(this._map.getBearing());
    this.value.textContent = `${bearing}°`;
    this.north.style.setProperty('--map-bearing', `${bearing}deg`);
    this.north.setAttribute('aria-valuenow', bearing);
    this.north.setAttribute('aria-valuetext', `${bearing}°${bearing ? '' : ', north up'}`);
    this.north.title = `Rotation ${bearing}°. Drag around the compass to rotate; select it to reset north up. `
      + 'Arrow keys: 1° (Shift: 0.1°); Page Up/Down: 15°. Shift + mouse wheel or a two-finger twist also rotates.';
    this.align.hidden = !this.view.hasFloorPlan();
    // The focused dial already reports its value to screen readers.
    if (announce && document.activeElement !== this.north) this.status.textContent = `Map rotated to ${bearing}°.`;
  },
});

function positionSiteLabels(map, labels, footprints, samples, scale) {
  const size = map.getSize(), view = L.bounds([0, 0], size);
  const margin = 80 * Math.max(1, scale);
  const nearby = L.bounds([-margin, -margin], size.add([margin, margin]));
  const grid = new Map(), cellSize = 96;
  const buckets = function* ({ min, max }) {
    for (let x = Math.floor(min.x / cellSize); x <= Math.floor(max.x / cellSize); x++) {
      for (let y = Math.floor(min.y / cellSize); y <= Math.floor(max.y / cellSize); y++) yield `${x},${y}`;
    }
  };
  const add = box => {
    for (const key of buckets(box)) {
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(box);
    }
  };
  const project = coords => map.latLngToContainerPoint(L.GeoJSON.coordsToLatLng(coords));
  for (const { coords, radius } of footprints.values()) {
    const centre = project(coords);
    const extent = [radius * scale, radius * scale];
    const box = L.bounds(centre.subtract(extent), centre.add(extent));
    if (nearby.intersects(box)) add(box);
  }
  const pointPadding = sampleRadius + 2;
  const pointExtent = [pointPadding, pointPadding];
  samples.eachLayer(layer => {
    const centre = map.latLngToContainerPoint(layer.getLatLng());
    const box = L.bounds(centre.subtract(pointExtent), centre.add(pointExtent));
    if (view.intersects(box)) add(box);
  });
  const visible = labels.flatMap(({ marker, text, key }) => {
    const centre = map.latLngToContainerPoint(marker.getLatLng());
    if (!nearby.contains(centre)) {
      text.style.visibility = 'hidden';
      return [];
    }
    return [{ centre, text, width: text.offsetWidth, height: text.offsetHeight, radius: footprints.get(key)?.radius || 6 }];
  });
  for (const { centre, text, width, height, radius } of visible) {
    const gap = radius * scale + 5;
    const choices = [[gap, -height / 2], [-gap - width, -height / 2], [-width / 2, -gap - height], [-width / 2, gap],
      [gap, -gap - height], [-gap - width, -gap - height], [gap, gap], [-gap - width, gap]];
    const candidates = choices.map(offset => {
      const start = centre.add(offset);
      return { offset, box: L.bounds(start, start.add([width, height])) };
    });
    const clear = box => ![...buckets(box)].some(key => grid.get(key)?.some(other => box.intersects(other)));
    const choice = candidates.find(({ box }) => view.contains(box) && clear(box));
    text.style.visibility = choice ? '' : 'hidden';
    if (!choice) continue;
    add(choice.box);
    text.style.setProperty('--site-label-x', `${choice.offset[0]}px`);
    text.style.setProperty('--site-label-y', `${choice.offset[1]}px`);
  }
}

export function createMapView(element, selector, reportError, capture = false, { planar = false, onRotate, onRotating } = {}) {
  const map = L.map(element, { preferCanvas: true, minZoom: planar ? -8 : 1, maxZoom: planar ? 10 : 20, attributionControl: true,
    zoomAnimation: !capture, fadeAnimation: !capture, rotate: true, bearing: 0, rotateControl: false, touchRotate: !capture,
    shiftKeyRotate: !capture, zoomSnap: .25, ...(planar ? { crs: L.CRS.Simple } : {}) });
  map.attributionControl.setPrefix(false);
  // A bearing can only be applied to a loaded map, and it must be set before fitting the samples.
  map.setView([0, 0], planar ? 0 : 1, { animate: false });
  element.dataset.bearing = '0';
  // Map-aligned layers live in the rotating pane; markers and labels stay upright in the other pane.
  const planPane = map.createPane('floor-plan', map.getPane('rotatePane'));
  planPane.style.zIndex = '250';
  planPane.style.pointerEvents = 'none';
  let floorPlan;
  map.createPane('actix-sectors', map.getPane('rotatePane')).style.zIndex = '350';
  const lines = L.layerGroup().addTo(map);
  const lineRenderer = L.svg();
  const hoverLines = L.layerGroup().addTo(map);
  const hoverPane = map.createPane('actix-hover-links', map.getPane('rotatePane'));
  hoverPane.style.zIndex = '410';
  hoverPane.style.pointerEvents = 'none';
  const hoverRenderer = L.svg({ pane: 'actix-hover-links' });
  let tiles = [];
  let basemap = 'local';
  let points;
  let cells;
  let bounds;
  let fitPoints = [];
  let sitesById = new Map();
  let sectorRadii = new Map();
  let labels = [], footprints = new Map();
  let hovered;
  let selected;
  let selectedPopup;
  let selectedOutline;
  let hasColorLegend;
  let showActix;
  let showHoverLinks = true;
  let siteScale = 1;
  for (const option of selector.options) if (!sources[option.value]) {
    option.disabled = true;
    option.textContent += ' (not configured)';
  }
  if (selector.selectedOptions[0]?.disabled) selector.value = 'local';

  function setBasemap(value) {
    if (planar) value = 'local';
    if (value !== basemap) {
      basemap = value;
      for (const layer of tiles) layer.remove();
      tiles = (sources[value] || []).map(({ url, attribution, maxNativeZoom }) => {
        const layer = L.tileLayer(url, { attribution, maxNativeZoom, noWrap: true, maxZoom: 20,
          crossOrigin: capture ? 'anonymous' : false, referrerPolicy: 'strict-origin-when-cross-origin' });
        layer.once('tileerror', () => reportError('Some basemap tiles could not load. The survey points are still available.'));
        return layer.addTo(map);
      });
    }
    updatePlanBasemap();
  }
  // Without basemap tiles the floor plan itself is the basemap, on a plain paper background.
  const planIsBasemap = () => Boolean(floorPlan) && basemap === 'local';
  function updatePlanBasemap() {
    element.classList.toggle('floor-plan-basemap', planIsBasemap());
  }
  function setPlanStyle({ transparency = 0 } = {}) {
    element.style.setProperty('--plan-opacity', 1 - transparency / 100);
  }
  const limit = 6000;
  function preview({ type, features }) {
    if (features.length <= limit) return { type, features };
    return { type, features: Array.from({ length: limit }, (_, index) => features[Math.floor(index * (features.length - 1) / (limit - 1))]) };
  }
  // Fit the real points in the rotated screen frame; a rotated lat/lng box would leave the view zoomed out.
  function fit(linkedCells = []) {
    map.invalidateSize();
    const points = capture && floorPlan ? [] : [...fitPoints];
    let cellPadding = 0;
    for (const site of linkedCells) {
      points.push(site.geometry.coordinates);
      const radius = sectorRadii.get(siteSectorKey(site)) || 0;
      cellPadding = Math.max(cellPadding, (radius + 3) * siteScale + 8);
    }
    if (floorPlan) {
      const [origin, right, down] = floorPlan.plan.corners;
      points.push(origin, right, down, [right[0] + down[0] - origin[0], right[1] + down[1] - origin[1]]);
    }
    if (!points.length) return;
    const angle = map.getBearing() * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [lon, lat] of points) {
      const { x, y } = map.project([lat, lon], 0);
      const rx = x * cos - y * sin, ry = x * sin + y * cos;
      minX = Math.min(minX, rx);
      maxX = Math.max(maxX, rx);
      minY = Math.min(minY, ry);
      maxY = Math.max(maxY, ry);
    }
    const size = map.getSize();
    const padding = Math.min(Math.max(20, cellPadding), Math.min(size.x, size.y) / 3);
    const room = size.subtract([2 * padding, 2 * padding]);
    const scale = Math.min(room.x / Math.max(maxX - minX, 1e-9), room.y / Math.max(maxY - minY, 1e-9));
    const snap = map.options.zoomSnap || 1;
    const zoom = Math.max(map.getMinZoom(), Math.min(Math.floor(map.getScaleZoom(scale, 0) / snap) * snap, planar ? 10 : floorPlan ? 20 : 16));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    map.setView(map.unproject([cx * cos + cy * sin, cy * cos - cx * sin], 0), zoom, { animate: capture ? false : undefined });
  }
  function setFloorPlan(plan) {
    if (floorPlan?.plan === plan) return;
    floorPlan?.remove();
    floorPlan = plan ? new FloorPlanLayer(plan).addTo(map) : undefined;
    updatePlanBasemap();
    rotation?.update();
  }
  function setBearing(degrees) {
    const bearing = normalBearing(Number(degrees) || 0);
    if (bearing === normalBearing(map.getBearing())) return false;
    map.setBearing(bearing);
    return true;
  }
  function alignToFloorPlan() {
    if (!floorPlan) return;
    const [origin, right] = floorPlan.plan.corners.map(point => map.project(L.GeoJSON.coordsToLatLng(point), 0));
    setBearing(alignedBearing(origin, right));
  }
  const rotation = capture ? undefined : new RotationControl({ setBearing, alignToFloorPlan, hasFloorPlan: () => Boolean(floorPlan) }).addTo(map);
  let announceTimer, quiet = false;
  map.on('rotate', () => {
    const bearing = normalBearing(map.getBearing());
    element.dataset.bearing = bearing;
    rotation?.update();
    onRotating?.(bearing);
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      rotation?.update(!quiet);
      quiet = false;
      placeLabels();
      onRotate?.(bearing);
    }, 250);
  });
  function drawSampleLinks(feature, group, renderer) {
    group.clearLayers();
    if (!showActix || !feature?.siteLinks) return;
    const from = L.GeoJSON.coordsToLatLng(feature.geometry.coordinates);
    const destinations = new Map();
    for (const { siteId, exact } of feature.siteLinks) {
      const site = sitesById.get(siteId);
      if (!site) continue;
      const { geometry: { coordinates }, angles } = site;
      const azimuth = angles && angles.beamwidth < 360 ? angles.azimuth : null;
      const radius = azimuth === null ? 0 : sectorRadii.get(siteSectorKey(site));
      const key = JSON.stringify([coordinates, azimuth, radius]);
      if (!destinations.has(key) || exact) destinations.set(key, { coordinates, azimuth, radius, exact });
    }
    for (const { coordinates, azimuth, radius, exact } of destinations.values()) {
      const site = L.GeoJSON.coordsToLatLng(coordinates);
      const end = radius ? map.layerPointToLatLng(map.latLngToLayerPoint(site).add(sectorOffset(azimuth, radius * siteScale))) : site;
      const ends = [from, end];
      const options = { renderer, interactive: false, dashArray: exact ? null : '7 6' };
      group.addLayer(L.polyline(ends, { ...options, color: '#fff', weight: 5 }));
      group.addLayer(L.polyline(ends, { ...options, className: 'actix-site-link', color: '#1A2E61', weight: 3 }));
    }
  }
  const drawHoverLinks = () => drawSampleLinks(showHoverLinks && hovered !== selected ? hovered : undefined, hoverLines, hoverRenderer);
  function drawLinks() {
    drawSampleLinks(selected, lines, lineRenderer);
    drawHoverLinks();
  }
  // Sector symbols are a fixed pixel size, so reproject the endpoint at each zoom.
  map.on('zoomend', drawLinks);
  const placeLabels = () => {
    if (showActix && points && labels.length && cells && map.hasLayer(cells)) {
      positionSiteLabels(map, labels, footprints, points, siteScale);
    }
  };
  map.on('moveend', placeLabels);
  function setSiteStyle({ size, transparency }) {
    const previousScale = siteScale;
    siteScale = size / 100;
    element.style.setProperty('--actix-scale', siteScale);
    element.style.setProperty('--actix-opacity', 1 - transparency / 100);
    if (siteScale !== previousScale) {
      placeLabels();
      drawLinks();
    }
  }
  const outlineColor = ({ COLOR }) => hasColorLegend ? '#131A35' : COLOR;
  function selectSample(feature) {
    const latLng = L.GeoJSON.coordsToLatLng(feature.geometry.coordinates);
    const popup = L.popup().setLatLng(latLng)
      .setContent(samplePopup(feature.properties)).openOn(map);
    selected = feature;
    selectedPopup = popup;
    drawLinks();
    selectedOutline = L.circleMarker(latLng, { renderer: lineRenderer, interactive: false, radius: sampleRadius,
      className: 'selected-sample-outline', color: outlineColor(feature.properties), weight: 2, fill: false }).addTo(map);
  }
  map.on('popupclose', ({ popup }) => {
    if (popup !== selectedPopup) return;
    selected = selectedPopup = undefined;
    selectedOutline?.remove();
    selectedOutline = undefined;
    lines.clearLayers();
    drawHoverLinks();
  });
  function clearHover() {
    hovered = undefined;
    hoverLines.clearLayers();
  }
  function clearLayers() {
    clearHover();
    points?.remove();
    cells?.remove();
    points = cells = bounds = undefined;
    fitPoints = [];
    sitesById.clear();
    sectorRadii.clear();
    labels = [];
    footprints.clear();
  }
  function clear() {
    selectedPopup?.close();
    clearLayers();
  }
  function renderSamples(samples) {
    clearHover();
    points?.remove();
    points = L.geoJSON(preview(samples), {
      pointToLayer: ({ properties }, latLng) => L.circleMarker(latLng, { radius: sampleRadius, stroke: false, color: outlineColor(properties), weight: 2,
        fillColor: properties.COLOR, fillOpacity: .92 }),
      onEachFeature: (feature, layer) => {
        if (!capture) layer.bindTooltip(() => {
          const label = document.createElement('span');
          const { properties } = feature;
          label.textContent = `${metricName(properties.KPI)}: ${sampleValue(properties)}`;
          return label;
        }, { direction: 'top', offset: [0, -6], className: 'survey-point-tooltip' });
        layer.on({
          mouseover: () => {
            layer.setStyle({ stroke: true });
            if (!capture) {
              hovered = feature;
              drawHoverLinks();
            }
          },
          mouseout: () => {
            layer.setStyle({ stroke: false });
            if (hovered === feature) clearHover();
          },
          click: () => selectSample(feature),
        });
      },
    }).addTo(map);
    bounds = L.latLngBounds([]);
    fitPoints = samples.features.map(({ geometry: { coordinates } }) => coordinates);
    for (const [lon, lat] of fitPoints) bounds.extend([lat, lon]);
    return Math.min(samples.features.length, limit);
  }
  function setSiteOverlay({ sites, sectors }) {
    cells?.remove();
    footprints.clear();
    sitesById = new Map(sites.features.map(site => [site.id, site]));
    const popup = (feature, layer) => layer.bindPopup(() => samplePopup(feature.properties));
    const visibleSites = preview(sites);
    const cellMarkers = L.geoJSON(visibleSites, {
      pointToLayer: (_, latLng) => L.marker(latLng, { icon: siteCentreIcon, keyboard: false }), onEachFeature: popup,
    });
    const styledSectors = layoutSectors(sectors);
    sectorRadii = new Map(styledSectors.map(sector => [sectorKey(sector), sector.radius]));
    for (const { coords, radius } of styledSectors) {
      const key = JSON.stringify(coords);
      if (!footprints.has(key) || footprints.get(key).radius < radius + 2) footprints.set(key, { coords, radius: radius + 2 });
    }
    labels = siteLabels(visibleSites);
    const sectorMarkers = styledSectors.map(sector =>
      new SectorMarker(L.GeoJSON.coordsToLatLng(sector.coords), {
        icon: sectorIcon(sector), pane: 'actix-sectors', interactive: false, keyboard: false,
      }));
    cells = L.layerGroup([...sectorMarkers, cellMarkers, ...labels.map(({ marker }) => marker)]);
    if (showActix && bounds.isValid()) cells.addTo(map);
    placeLabels();
    drawLinks();
    return visibleSites.features.length;
  }
  function render({ samples, sites, categoryLegend, thresholdLegend, valueLegend, sectors }, showSites, preserveSelection) {
    if (preserveSelection) clearLayers();
    else clear();
    showActix = showSites;
    hasColorLegend = categoryLegend.length > 0 || thresholdLegend.length > 0 || valueLegend.length > 0;
    const plotted = renderSamples(samples);
    const sitesPlotted = setSiteOverlay({ sites, sectors });
    if (selected) {
      const { DEVICE, LOG_ROW, WORKBOOK, SURVEYDAY, NETWORK } = selected.properties;
      selected = samples.features.find(({ properties }) => properties.DEVICE === DEVICE && properties.LOG_ROW === LOG_ROW)
        || { geometry: selected.geometry, properties: { DEVICE, LOG_ROW, WORKBOOK, SURVEYDAY, NETWORK, VALUE: null, COLOR: '#131A35' } };
      selectedOutline.setStyle({ color: outlineColor(selected.properties) });
      selectedPopup.setContent(samplePopup(selected.properties));
      drawLinks();
    } else {
      fit();
    }
    return { plotted, sitesPlotted };
  }
  return { render, setBasemap, setSiteStyle, setPlanStyle, planIsBasemap, setFloorPlan, setBearing(degrees) {
    if (setBearing(degrees)) quiet = true;
  }, getBearing: () => normalBearing(map.getBearing()),
    alignToFloorPlan, planar, fit, clear, selectSample, setSiteOverlay, setSamples(samples) {
    if (selected && !samples.features.includes(selected)) selectedPopup.close();
    const plotted = renderSamples(samples);
    placeLabels();
    return plotted;
  }, destroy: () => {
    clearTimeout(announceTimer);
    map.remove();
  },
    tilesLoading: () => tiles.some(layer => layer.isLoading()), selectedDevice: () => selected?.properties.DEVICE, setHoverLinks(show) {
    showHoverLinks = show;
    drawHoverLinks();
  }, setCells(show) {
    showActix = show;
    if (cells) show ? cells.addTo(map) : cells.remove();
    placeLabels();
    drawLinks();
  } };
}

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { escapeMarkup, format } from './charts.js';
import { layoutSectors, sectorKey, sectorColor } from './sector-style.js';

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

function samplePopup(props) {
  const popup = document.createElement('dl');
  const details = props.KIND === 'Actix cell' ? {
    Network: props.RAT, 'Snapshot date': props.SNAPSHOT, Cell: props.CELL_ID, Site: props.SITE_ID, Sector: props.SECTOR, Match: props.MATCH,
  } : {
    Workbook: props.WORKBOOK, Device: props.DEVICE, 'Log row': props.LOG_ROW, 'Survey date': props.SURVEYDAY,
    Network: props.NETWORK,
    Value: props.CATEGORY || (props.VALUE == null ? 'No reading for this KPI' : format(props.VALUE)),
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
  html: '<svg width="11" height="11" aria-hidden="true"><circle cx="5.5" cy="5.5" r="4.5" fill="#FFF1B6" fill-opacity=".8" stroke="#833C1C" stroke-width="2" stroke-dasharray="3 3"/></svg>' });

function sectorOffset(angle, radius) {
  const radians = angle * Math.PI / 180;
  return L.point(radius * Math.sin(radians), -radius * Math.cos(radians));
}

function sectorMarker(sector) {
  const { rat, coords, azimuth, beamwidth, inner, radius } = sector;
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
  const icon = L.divIcon({ className: `actix-sector actix-sector-${rat.toLowerCase()}`,
    html: `<svg viewBox="${-half} ${-half} ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><path d="${path}" fill="none" stroke="#131A35" stroke-width="3"/><path d="${path}" fill="${color}" fill-opacity=".56" fill-rule="evenodd" stroke="${color}" stroke-width="1.5"/></svg>`,
    iconSize: [size, size] });
  return L.marker(L.GeoJSON.coordsToLatLng(coords), { icon, pane: 'actix-sectors', interactive: false, keyboard: false });
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

function positionSiteLabels(map, labels, footprints) {
  const size = map.getSize(), view = L.bounds([0, 0], size);
  const nearby = L.bounds([-80, -80], size.add([80, 80]));
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
    const box = L.bounds(centre.subtract([radius, radius]), centre.add([radius, radius]));
    if (nearby.intersects(box)) add(box);
  }
  const visible = labels.flatMap(({ marker, text, key }) => {
    const centre = map.latLngToContainerPoint(marker.getLatLng());
    if (!nearby.contains(centre)) return [];
    return [{ centre, text, width: text.offsetWidth, height: text.offsetHeight, radius: footprints.get(key)?.radius || 6 }];
  });
  for (const { centre, text, width, height, radius } of visible) {
    const gap = radius + 5;
    const choices = [[gap, -height / 2], [-gap - width, -height / 2], [-width / 2, -gap - height], [-width / 2, gap]];
    const candidates = choices.map(offset => {
      const start = centre.add(offset);
      return { offset, box: L.bounds(start, start.add([width, height])) };
    });
    const clear = box => ![...buckets(box)].some(key => grid.get(key)?.some(other => box.intersects(other)));
    const choice = candidates.find(({ box }) => view.contains(box) && clear(box))
      || candidates.find(({ box }) => view.contains(box)) || candidates[0];
    add(choice.box);
    text.style.setProperty('--site-label-x', `${choice.offset[0]}px`);
    text.style.setProperty('--site-label-y', `${choice.offset[1]}px`);
  }
}

export function createMapView(element, selector, reportError) {
  const map = L.map(element, { preferCanvas: true, minZoom: 1, maxZoom: 20, attributionControl: true });
  map.attributionControl.setPrefix(false);
  map.createPane('actix-sectors').style.zIndex = '350';
  const lines = L.layerGroup().addTo(map);
  const lineRenderer = L.svg();
  let tiles = [];
  let basemap = 'local';
  let points;
  let cells;
  let bounds;
  let sitesById = new Map();
  let sectorRadii = new Map();
  let labels = [], footprints = new Map();
  let selected;
  let selectedPopup;
  let selectedOutline;
  let hasColorLegend;
  let showActix;
  for (const option of selector.options) if (!sources[option.value]) {
    option.disabled = true;
    option.textContent += ' (not configured)';
  }
  if (selector.selectedOptions[0]?.disabled) selector.value = 'local';

  function setBasemap(value) {
    if (value === basemap) return;
    basemap = value;
    for (const layer of tiles) layer.remove();
    tiles = (sources[value] || []).map(({ url, attribution, maxNativeZoom }) => {
      const layer = L.tileLayer(url, { attribution, maxNativeZoom, noWrap: true, maxZoom: 20, referrerPolicy: 'strict-origin-when-cross-origin' });
      layer.once('tileerror', () => reportError('Some basemap tiles could not load. The survey points are still available.'));
      return layer.addTo(map);
    });
  }
  const limit = 6000;
  function preview({ type, features }) {
    if (features.length <= limit) return { type, features };
    return { type, features: Array.from({ length: limit }, (_, index) => features[Math.floor(index * (features.length - 1) / (limit - 1))]) };
  }
  function fit() {
    map.invalidateSize();
    if (bounds?.isValid()) map.fitBounds(bounds, { padding: [20, 20], maxZoom: 16 });
  }
  function drawLinks() {
    lines.clearLayers();
    if (!showActix || !selected?.siteLinks) return;
    const from = L.GeoJSON.coordsToLatLng(selected.geometry.coordinates);
    const destinations = new Map();
    for (const { siteId, exact } of selected.siteLinks) {
      const { geometry: { coordinates }, angles, carrier, properties: { RAT } } = sitesById.get(siteId);
      const azimuth = angles && angles.beamwidth < 360 ? angles.azimuth : null;
      const radius = azimuth === null ? 0 : sectorRadii.get(sectorKey({ rat: RAT, coords: coordinates, ...angles, carrier }));
      const key = JSON.stringify([coordinates, azimuth, radius]);
      if (!destinations.has(key) || exact) destinations.set(key, { coordinates, azimuth, radius, exact });
    }
    for (const { coordinates, azimuth, radius, exact } of destinations.values()) {
      const site = L.GeoJSON.coordsToLatLng(coordinates);
      const end = radius ? map.layerPointToLatLng(map.latLngToLayerPoint(site).add(sectorOffset(azimuth, radius))) : site;
      const ends = [from, end];
      const options = { renderer: lineRenderer, interactive: false, dashArray: exact ? null : '7 6' };
      lines.addLayer(L.polyline(ends, { ...options, color: '#fff', weight: 5 }));
      lines.addLayer(L.polyline(ends, { ...options, className: 'actix-site-link', color: '#1A2E61', weight: 3 }));
    }
  }
  // Sector symbols are a fixed pixel size, so reproject the endpoint at each zoom.
  map.on('zoomend', drawLinks);
  const placeLabels = () => { if (showActix && cells && map.hasLayer(cells)) positionSiteLabels(map, labels, footprints); };
  map.on('moveend', placeLabels);
  const outlineColor = ({ COLOR }) => hasColorLegend ? '#131A35' : COLOR;
  function selectSample(feature) {
    const latLng = L.GeoJSON.coordsToLatLng(feature.geometry.coordinates);
    const popup = L.popup().setLatLng(latLng)
      .setContent(samplePopup(feature.properties)).openOn(map);
    selected = feature;
    selectedPopup = popup;
    drawLinks();
    selectedOutline = L.circleMarker(latLng, { renderer: lineRenderer, interactive: false, radius: 5,
      className: 'selected-sample-outline', color: outlineColor(feature.properties), weight: 2, fill: false }).addTo(map);
  }
  map.on('popupclose', ({ popup }) => {
    if (popup !== selectedPopup) return;
    selected = selectedPopup = undefined;
    selectedOutline?.remove();
    selectedOutline = undefined;
    lines.clearLayers();
  });
  function clearLayers() {
    points?.remove();
    cells?.remove();
    points = cells = bounds = undefined;
    sitesById.clear();
    sectorRadii.clear();
    labels = [];
    footprints.clear();
  }
  function clear() {
    selectedPopup?.close();
    clearLayers();
  }
  function render({ samples, sites, extent, technologyLegend, thresholdLegend, ueColors, sectors }, showSites, preserveSelection) {
    if (preserveSelection) clearLayers();
    else clear();
    showActix = showSites;
    sitesById = new Map(sites.features.map(site => [site.id, site]));
    const popup = (feature, layer) => layer.bindPopup(() => samplePopup(feature.properties));
    hasColorLegend = technologyLegend.length > 0 || thresholdLegend.length > 0;
    const fill = ({ VALUE, COLOR }) => {
      if (hasColorLegend || ueColors || !extent || VALUE === null) return COLOR;
      const [min, max] = extent;
      if (min === max) return '#0055B8';
      const weight = (VALUE - min) / (max - min);
      return `rgb(${[13, 84, 255].map((low, index) => Math.round(low + weight * ([210, 76, 17][index] - low))).join(',')})`;
    };
    points = L.geoJSON(preview(samples), {
      pointToLayer: ({ properties }, latLng) => L.circleMarker(latLng, { radius: 5, stroke: false, color: outlineColor(properties), weight: 2,
        fillColor: fill(properties), fillOpacity: .92 }),
      onEachFeature: (feature, layer) => layer.on({
        mouseover: () => layer.setStyle({ stroke: true }),
        mouseout: () => layer.setStyle({ stroke: false }),
        click: () => selectSample(feature),
      }),
    }).addTo(map);
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
    cells = L.layerGroup([...styledSectors.map(sectorMarker), cellMarkers, ...labels.map(({ marker }) => marker)]);
    bounds = L.latLngBounds([]);
    for (const { geometry: { coordinates: [lon, lat] } } of samples.features) bounds.extend([lat, lon]);
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
    if (showSites && bounds.isValid()) {
      cells.addTo(map);
      placeLabels();
    }
    return { plotted: Math.min(samples.features.length, limit), sitesPlotted: Math.min(sites.features.length, limit) };
  }
  return { render, setBasemap, fit, clear, selectSample, selectedDevice: () => selected?.properties.DEVICE, setCells(show) {
    showActix = show;
    if (cells) show ? cells.addTo(map) : cells.remove();
    placeLabels();
    drawLinks();
  } };
}

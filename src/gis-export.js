import shpwrite from '@mapbox/shp-write';
import { escapeMarkup } from './charts.js';

const xml = value => escapeMarkup(String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, ''));

export function makeKml({ samples, sites }, title) {
  const folder = (name, features) => `<Folder><name>${name}</name>${features.map(({ geometry, properties }) => {
    const data = Object.entries(properties).filter(([, value]) => value != null)
      .map(([key, value]) => `<Data name="${xml(key)}"><value>${xml(value)}</value></Data>`).join('');
    const name = properties.KIND === 'Actix cell' ? `${properties.RAT} ${properties.CELL_ID || properties.SITE_ID}` : `${properties.DEVICE} · row ${properties.LOG_ROW}`;
    return `<Placemark><name>${xml(name)}</name><ExtendedData>${data}</ExtendedData><Point><coordinates>${geometry.coordinates.join(',')}</coordinates></Point></Placemark>`;
  }).join('')}</Folder>`;
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(title)}</name>${folder('KPI samples', samples.features)}${folder('Actix cells', sites.features)}</Document></kml>`;
}

export function makeShapefile({ samples, sites }) {
  const features = [...samples.features, ...sites.features];
  // DBF column types are inferred across rows. Seed every row with the same set of keys.
  const template = Object.fromEntries([...new Set(features.flatMap(({ properties }) => Object.keys(properties)))].map(key => [key, null]));
  return shpwrite.zip({ type: 'FeatureCollection', features: features.map(feature => ({
    ...feature, properties: { ...template, ...feature.properties },
  })) }, { outputType: 'arraybuffer', compression: 'DEFLATE', types: { point: 'survey_points' } });
}

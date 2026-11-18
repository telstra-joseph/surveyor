import { mapFeatures, parseActix } from './geo.js';
import { makeKml, makeShapefile } from './gis-export.js';

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'catalog') {
      self.postMessage({ snapshot: parseActix(await data.file.text(), data.file.name, data.date) });
    } else if (data.type === 'map') {
      self.postMessage({ map: mapFeatures(data) });
    } else if (data.type === 'kml') {
      self.postMessage({ kml: makeKml(data.map, data.title) });
    } else if (data.type === 'shapefile') {
      const buffer = await makeShapefile(data.map);
      self.postMessage({ buffer }, [buffer]);
    } else {
      throw new Error('Unsupported GIS operation.');
    }
  } catch (error) {
    self.postMessage({ error: error.message || 'The GIS operation failed.' });
  }
};

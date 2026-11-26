import L from 'leaflet';

// leaflet-rotate patches the global Leaflet instance, so expose the bundled one before it loads.
globalThis.L = L;

export default L;

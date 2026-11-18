// Google Earth presentation-layer carrier colours, converted from KML AABBGGRR to RGB.
const carrierColors = new Map(Object.entries({
  A: '#FF0000', B: '#00FF00', C: '#800080', DA: '#FF007F', E: '#FFFF00', F: '#00FFFF',
  G: '#000080', H: '#F0F0F0', J: '#0000FF', K: '#808000', P: '#FFAA00', R: '#008000',
  T: '#00AAAA', U: '#FFAA55', V: '#5555FF', W: '#55FF55', X: '#008080', Z: '#800000',
}));
const bands = {
  LTE: new Map(Object.entries({ F: '700', H: '850e', E: '1800', K: '1800', J: '2100', A: '2600', B: '2600' })),
  NR: new Map(Object.entries({ V: '850', Z: '2600', X: '2600', C: '3600', R: '3700', D: '26000' })),
};

export function carrierCode(site, ...labels) {
  const prefix = site.toUpperCase();
  if (!prefix) return '';
  for (const label of labels) {
    const name = label.toUpperCase();
    if (!name.startsWith(prefix)) continue;
    const tail = name.slice(prefix.length);
    if (!/^[A-Z]{2}[A-Z0-9]{1,3}$/.test(tail)) continue;
    const code = tail[0] === 'D' ? 'DA' : tail[0];
    if (carrierColors.has(code)) return code;
  }
  return '';
}

export const sectorKey = ({ rat, coords, azimuth, beamwidth, carrier }) =>
  JSON.stringify([rat, coords, azimuth, beamwidth, carrier]);

export function sectorColor({ rat, carrier }) {
  return carrierColors.get(carrier) || (rat === 'NR' ? '#0D54FF' : '#A94318');
}

export function sectorLegendGroups(sectors) {
  return ['LTE', 'NR'].flatMap(rat => {
    const entries = new Map();
    for (const sector of sectors) {
      if (sector.rat !== rat) continue;
      const code = sector.carrier === 'DA' ? 'D' : sector.carrier;
      const band = bands[rat].get(code);
      entries.set(code, { label: band ? `${code} ${band} MHz` : code || 'Unknown', color: sectorColor(sector), band });
    }
    return entries.size ? [{
      rat,
      entries: [...entries.values()].sort((a, b) => (parseInt(a.band, 10) || Infinity) - (parseInt(b.band, 10) || Infinity)
        || a.label.localeCompare(b.label)),
    }] : [];
  });
}

export function layoutSectors(sectors) {
  const bearings = new Map();
  for (const sector of sectors) {
    const { coords, azimuth, beamwidth } = sector;
    const key = JSON.stringify([coords, beamwidth === 360 ? null : azimuth]);
    if (!bearings.has(key)) bearings.set(key, []);
    bearings.get(key).push(sector);
  }
  return [...bearings.values()].flatMap(group => {
    group.sort((a, b) => a.rat.localeCompare(b.rat) || a.carrier.localeCompare(b.carrier) || a.beamwidth - b.beamwidth);
    const step = Math.min(7, 42 / group.length);
    return group.map((sector, i) => ({ ...sector, inner: i ? 22 + (i - 1) * step : 0, radius: 22 + i * step }));
  });
}

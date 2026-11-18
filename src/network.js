export function networkFromLabel(value) {
  if (/\b(?:optus|vodafone|tpg|vha|vocus)\b/i.test(value)) return 'other';
  return /\btelstra\b/i.test(value) ? 'telstra' : '';
}

export function networkColumns(columns) {
  const groups = new Map();
  for (const [col, key] of columns) {
    const name = key.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const field = /^(?:(?<prefix>(?:lte|nr|5g|nemo|ue|serving|cell|network|registered)(?:_(?:ue|serving|cell|network|registered|rrc))*)_)?(?<kind>mcc|mnc|plmn|plmn_id)(?:_(?<index>\d+))?$/.exec(name);
    if (!field) continue;
    const { prefix = '', kind, index = '' } = field.groups;
    const group = `${prefix}:${index}`;
    if (!groups.has(group)) groups.set(group, {});
    groups.get(group)[kind] = col;
  }
  return [...groups.values()];
}

function classify(mcc, mnc) {
  return mcc === '505' && /^(?:01|1)$/.test(mnc) ? 'telstra' : 'other';
}

export function addNetworkEvidence(evidence, groups, read) {
  for (const group of groups) {
    const value = col => col === undefined ? '' : read(col);
    const mcc = value(group.mcc);
    const mnc = value(group.mnc);
    if (/^\d{3}$/.test(mcc) && /^\d{1,3}$/.test(mnc)) evidence.add(classify(mcc, mnc));
    for (const col of [group.plmn, group.plmn_id]) {
      const plmn = /^(\d{3})(?:[-/ ]*)(\d{2,3})$/.exec(value(col));
      if (plmn) evidence.add(classify(plmn[1], plmn[2]));
    }
  }
}

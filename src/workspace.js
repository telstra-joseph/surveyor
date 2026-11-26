const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const arrayOf = (value, check) => Array.isArray(value) && value.every(check);
const string = value => typeof value === 'string';
const finite = Number.isFinite;
const pair = value => Array.isArray(value) && value.length === 2 && value.every(finite);
const coordinates = value => value === null || pair(value);
const scalar = value => finite(value) || string(value);
const rows = (value, key, reading) => arrayOf(value, row =>
  Array.isArray(row) && row.length === 2 && key(row[0]) && reading(row[1]));
const validLocation = row => record(row) && coordinates(row.coords) && (row.xy === undefined || pair(row.xy)) &&
  string(row.day) && record(row.radio) && Object.values(row.radio).every(values =>
    arrayOf(values, item => item === null || finite(item)));
const validMetric = metric => record(metric) && string(metric.key) &&
  rows(metric.series, finite, finite) && rows(metric.histogram, string, finite) && rows(metric.statistics, string, scalar) &&
  (metric.geoCategories === undefined || rows(metric.geoCategories, finite, string));
const validCell = cell => record(cell) && coordinates(cell.coords) && [cell.site, cell.name, cell.sector].every(string) &&
  (cell.angles === null || (record(cell.angles) && finite(cell.angles.azimuth) && finite(cell.angles.beamwidth)));

export const workspaceSnapshot = (imports, view) => ({ format: 'surveyor-workspace', version: 1, imports, view });

export function validateWorkspace(value) {
  if (value?.format !== 'surveyor-workspace') throw new Error('This is not a Surveyor workspace.');
  if (value.version !== 1) throw new Error('This Surveyor workspace version is not supported.');
  const { imports, view } = value;
  const error = part => new Error(`The workspace contains invalid ${part}.`);
  if (!record(imports)) throw error('imports');
  if (!arrayOf(imports.plans, plan => record(plan) && string(plan.id) && string(plan.name) &&
      typeof plan.planar === 'boolean' && plan.width > 0 && finite(plan.width) && plan.height > 0 && finite(plan.height) &&
      string(plan.image) && /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(plan.image) &&
      arrayOf(plan.corners, pair) && plan.corners.length === 3 && arrayOf(plan.markers, pair) &&
      (plan.bearing === undefined || finite(plan.bearing)) && (plan.transparency === undefined || finite(plan.transparency)) &&
      (plan.hidden === undefined || typeof plan.hidden === 'boolean'))) {
    throw error('floor plans');
  }
  const planIds = new Set(imports.plans.map(({ id }) => id));
  if (planIds.size !== imports.plans.length) throw error('floor plan IDs');
  if (!arrayOf(imports.surveys, survey => record(survey) && string(survey.filename) &&
      (survey.profile === undefined || string(survey.profile)) && finite(survey.rows) &&
      (survey.planId === undefined || planIds.has(survey.planId)) && arrayOf(survey.days, string) &&
      record(survey.geography) && Object.values(survey.geography).every(validLocation) &&
      arrayOf(survey.metrics, validMetric))) {
    throw error('workbooks');
  }
  if (!arrayOf(imports.snapshots, snapshot => record(snapshot) && ['LTE', 'NR'].includes(snapshot.rat) &&
      string(snapshot.day) && string(snapshot.filename) && arrayOf(snapshot.cells, validCell))) {
    throw error('Actix snapshots');
  }
  if (!record(view) || ![view.metric, view.mode, view.basemap, view.location].every(string) ||
      !['light', 'dark'].includes(view.theme) || !finite(view.outdoorBearing) ||
      !Number.isSafeInteger(view.group) || view.group < 0 || !record(view.values) || !record(view.checks) ||
      !Object.values(view.values).every(string) || !Object.values(view.checks).every(checked => typeof checked === 'boolean')) {
    throw error('view settings');
  }
  return value;
}

export function parseWorkspace(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error('The workspace file is not valid JSON.', { cause: error });
  }
  return validateWorkspace(data);
}

import { datasets } from './charts.js';
import { mapImage, svgImage } from './image-export.js';
import { mapLegendExportEntry, mapLegendFilter, mapPointLegend } from './map-colors.js';
import { supportsMapThresholds } from './map-thresholds.js';
import { createMapView } from './map-view.js';
import { mapSectors } from './sector-style.js';
import { mapWorkbook, radioFields } from './geo.js';
import { reportMetricName } from './report-labels.js';

const dataUrl = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

export async function captureReportMaps({ surveys, plans = [], bearing = 0, keys, snapshots, maxDays, basemap,
  showSites, siteStyle, matchPci, thresholds, sections, thresholdOverrides = {}, request, progress }) {
  const jobsFor = workbookIndexes => {
    const workbooks = workbookIndexes.map(index => surveys[index]);
    return keys.flatMap(key => datasets(workbooks, key, 'map')
      .map(item => ({ key, item, workbookIndex: workbookIndexes[item.index], multipleWorkbooks: workbooks.length > 1 })));
  };
  const jobs = sections ? sections.flatMap(({ workbookIndexes }) => jobsFor(workbookIndexes))
    : jobsFor(surveys.map((_, index) => index));
  if (!jobs.length) return [];
  const element = document.createElement('div');
  element.className = 'report-map-capture';
  element.setAttribute('aria-hidden', 'true');
  element.inert = true;
  document.body.append(element);
  let view;
  const maps = [];
  try {
    for (const [index, { key, item, workbookIndex, multipleWorkbooks }] of jobs.entries()) {
      const title = reportMetricName(key);
      progress(index + 1, jobs.length, title);
      const plan = plans.find(plan => plan.id === item.plan);
      const planar = Boolean(plan?.planar);
      if (!view || view.planar !== planar) {
        view?.destroy();
        view = createMapView(element, { options: [], selectedOptions: [] }, () => {}, true, { planar });
        view.setSiteStyle(siteStyle);
      }
      view.setFloorPlan(plan || null);
      view.setPlanStyle({ transparency: plan?.transparency || 0 });
      view.setBearing(plan ? plan.bearing || 0 : bearing);
      if (plan && !plan.orientationConfirmed && !plan.bearing) view.alignToFloorPlan();
      const mapBasemap = plan ? 'local' : basemap;
      if (mapBasemap === 'local') view.setBasemap('local');
      // Georeferenced indoor PCI maps need Actix matches for the legend, even though site overlays stay hidden.
      const catalog = !plan ? snapshots : planar ? [] : snapshots.filter(({ rat }) => radioFields[rat][1] === key);
      const { map } = await request({
        type: 'map', key, snapshots: catalog, maxDays,
        legendMode: multipleWorkbooks && supportsMapThresholds(key) ? (thresholds ? 'thresholds' : 'ue') : 'auto',
        thresholdOverride: Object.hasOwn(thresholdOverrides, key) ? thresholdOverrides[key] : undefined,
        workbooks: [mapWorkbook(surveys[workbookIndex], key, item.tag, item.color)],
      });
      if (!map.samples.features.length) continue;
      const sectors = mapSectors(map, matchPci);
      view.render({ ...map, sectors }, showSites && !plan, false);
      view.setBasemap(mapBasemap);
      const deadline = Date.now() + 4000;
      while (view.tilesLoading() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 80));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const capture = mapImage(element, title, mapBasemap !== 'local', { cropToFloorPlan: Boolean(plan) });
      const legend = mapPointLegend(key, map, [item]);
      if (legend.showCounts) {
        legend.entries = mapLegendFilter(map, legend.entries).entries.map(entry => mapLegendExportEntry(entry, true));
      }
      maps.push({
        key, workbookIndex, plan: plan?.name, width: capture.width, height: capture.height,
        image: await dataUrl(await svgImage(capture.svg, 'png')),
        legend,
        attribution: capture.attribution, missingBasemap: mapBasemap !== 'local' && !capture.hasBasemap,
      });
    }
    return maps;
  } finally {
    view?.destroy();
    element.remove();
  }
}

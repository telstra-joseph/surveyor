# Surveyor

Surveyor compares network-survey KPIs from Nemo formatted `.xlsx` workbooks and exports a PowerPoint report. It runs in the browser, with no server-side processing or file uploads.

## Run locally

Use Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

For an installable, offline-capable copy:

```sh
npm run build
npm run preview
```

For deployment, serve the contents of `dist` over HTTPS. On localhost or HTTPS, an initial online visit caches the production app, including its import and export workers. Install from the app button or the browser's install menu where supported. Workbooks are held only in memory and must be reimported after closing or reloading the app.

The browser favicon is [`public/favicon.ico`](./public/favicon.ico). If the wordmark or install icon in [`public/icon.svg`](./public/icon.svg) changes, regenerate the ICO at 16, 32, and 48 pixels to match.

## Use the workspace

Use the sun or moon icon in the header to switch themes. Surveyor follows your system theme until you make a choice, then remembers it in your browser. The horizon appears only during the brief icon transition, which respects reduced-motion settings. Exports keep their original colours.

Dropdown chevrons rotate and menus animate briefly in browsers that support native customizable selects. Reduced-motion settings disable the animations, and forced-colour mode uses standard browser controls.

1. Select the workbooks for one location together. The workbook and location fields sit side by side on wider screens and stack on narrow screens. There is no fixed workbook count or file-size cap; available browser memory is the practical limit. A successful new selection replaces the current survey. Import runs in up to four workers, depending on available CPU capacity.
2. Name the location and choose a KPI. **Distribution** uses the workbook's original ranges and counts, **Recorded samples** plots numeric measurements against their own workbook row positions, and **Source statistics** shows the values as supplied. The source tables are keyboard-accessible and retain every numeric sample, even when a dense plot is downsampled.
3. Choose SVG, PNG or JPG, then download the chart and its legend independently or select **Download both** for one image with the legend below the chart. **Copy plot to clipboard** copies the plot alone as PNG in supported browsers on HTTPS or localhost. When a KPI spans multiple workbook groups, choose a group to view and export. For distributions split across pages, image exports are for the visible page.
4. Use **Download PowerPoint** for a widescreen report. It includes all available KPIs and workbook groups, preferring workbook distributions, then recorded samples, then source statistics. Charts are editable shapes rather than live PowerPoint charts, and legends are editable tables.

The report uses the Macquarie Group reference's Telstra colour palette, typeface names, widescreen format, and visual-plus-legend layout. It does not copy the original imagery or embed the proprietary typefaces. Install the approved Telstra Display Medium and Telstra Text fonts locally for the intended appearance. The web app has an Arial fallback; PowerPoint may substitute its own fonts.

Distribution counts are not time shares. Missing values are not interpreted as zero. Workbook rows are not aligned across devices, unconfirmed throughput units are left as source units, and a carrier is not inferred from a missing label.

## Maps and serving-cell snapshots

- Choose **Map plot** for KPIs with GPS readings on the same row in `Series Formatted Data`. The Technology mode map colours points and builds its legend from the `Technology_Mode` values on those rows, not from workbook names or histogram totals. The map can preview a subset of dense data; the accessible source table and KML or Shapefile downloads include every mapped reading in the selected workbook group. These are WGS 84 point exports, not basemap images. The Shapefile ZIP contains `.shp`, `.shx`, `.dbf` and `.prj` files; use `KIND` to distinguish samples and cell markers.
- When one workbook is loaded, supported KPIs use threshold colours automatically. With two or more workbooks, use **Use KPI thresholds** in the map legend to switch from UE colours to shared thresholds for supported KPIs. The choice carries across supported KPIs and workbook groups. 4G RSRP and 5G SS-RSRP use the same coverage bands: Good (blue, ≥ −95 dBm), Moderate (green, −105 to < −95 dBm), Basic (yellow, −115 to < −105 dBm), and No coverage (red, < −115 dBm). LTE/NR SINR, downlink POLQA MOS, and app throughput maps retain the Macquarie Group bands, with red for numeric readings below the lowest band. Missing readings are not red. Throughput bands are shown in Mbps, while Nemo source values remain in kbps. Other maps keep their existing legends. GIS point exports include the selected `KPI_BAND` and its `COLOR` where applicable.
- Switching between KPIs in **Map plot** keeps the selected workbook row and map zoom in place. The popup updates to the new KPI, or says no reading is available if that row did not report it.
- Import the Actix LTE and NR CSVs under **Actix serving-cell snapshots**, which starts expanded when no snapshots are loaded. The app extracts the `YYYY-MM-DD` snapshot date from each filename. For an undated filename, supply the optional override before importing. A second file of the same technology and date replaces that snapshot. The closest date wins within the selected gap (seven days by default); ties prefer the earlier snapshot. Undated rows use the workbook's date only if it has exactly one observed date.
- Actix snapshots are Telstra-only. Logs without operator evidence are eligible for matching and labeled `Telstra (assumed)` in map details and GIS exports. Telstra's PLMN (`505-01`) or a Telstra device label is shown as `Telstra`. Evidence of another network blocks matching, even if a Telstra label is also present. A shared channel or cell ID never verifies the operator.
- For eligible logs, LTE ECI and NR NCI are matched first. If the ID is absent, a same-row PCI and downlink channel can identify candidates; the nearest candidate is shown with its distance and candidate count. A reported ID missing from the chosen inventory stays unmatched; PCI/channel candidates do not prove serving-cell identity.
- Sample pop-ups show only the LTE or NR cell name for each association, using `Cell_Name` when supplied and `Sector_ID` otherwise. The source table retains the detailed association information.
- Survey points only show an outline when hovered or selected. Select a sample on the map or use **Show on map** in the source table to see links to its associated Actix sites. Links end at the midpoint of the matched directional sector's outer arc; omnidirectional cells and cells without usable angles use the site centre. Solid links indicate unique ID matches; dashed links indicate PCI/channel candidates or duplicate IDs.
- Sector symbols use Actix `Azimuth` and `Beamwidth`; a 360° beam is circular, and sectors without usable angles are omitted. Recognised Actix cell or sector codes use the NSWACT Google Earth carrier palette. LTE and 5G NR both use solid sector outlines, and carriers sharing a bearing are drawn in separate bands. Unrecognised codes use a technology-specific fallback and are labelled **carrier unknown**. The map and its image exports have a separate Actix sector legend when those overlays are enabled. The symbols are screen-sized, not coverage footprints. The reference KML files are not required at runtime, and KML and Shapefile downloads remain point exports.
- The Actix sector legend groups channel codes by LTE and NR, with nominal MHz bands where the reference identifies them. Site labels move around sector symbols and nearby labels where there is room.
- **Keep imports in this browser across refreshes** saves parsed workbooks and Actix snapshots in local browser storage. It is off by default. Turn it off to remove the saved copy without clearing the current view, or use **Clear survey** and **Clear snapshots** to remove individual import types from both the app and its saved workspace.

- The map labels each plotted Actix site with its site code, once per site location even when several matched cells share it.

### Web basemaps

Map image downloads and clipboard copies capture the current viewport, including the plotted points and visible Actix overlays, without basemap tiles or pop-ups. **Download both** adds the active map legend to the image. KML and Shapefile downloads are unchanged.

**Street** is selected by default and loads when a map with samples opens. Choosing another basemap switches to it immediately, and your selection stays in effect until you change it or reload the app. **Street** uses [OpenStreetMap](https://www.openstreetmap.org/copyright), **Satellite** uses NASA Blue Marble, and **Hybrid** adds NASA GIBS place labels to the imagery. Blue Marble is regional imagery, not street-level photography. The map shows layer attribution. Surveyor does not prefetch or store tiles for offline use.

To override a source for deployment, supply both its non-secret URL and attribution variables when running the dev server or building the app. Each URL must be an HTTPS or same-origin XYZ template containing `{z}`, `{x}` and `{y}`. Use the provider's required attribution text.

| Option | URL environment variable | Attribution environment variable |
| --- | --- | --- |
| Street (OpenStreetMap) | `VITE_STREET_TILE_URL` | `VITE_STREET_TILE_ATTRIBUTION` |
| Satellite | `VITE_SATELLITE_TILE_URL` | `VITE_SATELLITE_TILE_ATTRIBUTION` |
| Hybrid labels (transparent tiles over Satellite) | `VITE_LABELS_TILE_URL` | `VITE_LABELS_TILE_ATTRIBUTION` |

Loading an online basemap makes viewport tile requests to its provider. The application does not send the workbook, cell catalog or plotted measurements. Use **No basemap** for sensitive locations. Local maps and exports work offline.

Run the focused automated checks with `npm test`.

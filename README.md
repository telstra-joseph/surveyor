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

Dropdowns match the height of standard buttons. Dropdown chevrons rotate and menus animate briefly in browsers that support native customizable selects. Reduced-motion settings disable the animations, and forced-colour mode uses standard browser controls.

1. Select workbooks for one location together or in batches. Each batch adds to the current survey. Use **Clear survey** before starting over. The workbook and location fields sit side by side on wider screens and stack on narrow screens. There is no fixed workbook count or file-size cap; available browser memory is the practical limit. Import runs in up to four workers, depending on available CPU capacity. Use **×** beside an imported workbook to remove it from the survey and any saved workspace without deleting the original file.

   Each batch is ordered by UE number (from the device label, or the filename if the label has none), with unnumbered workbooks last. New batches take the next available S numbers. Use the up and down arrows under **Imported workbooks** to change the order and reassign S numbers.
2. Name the location and choose a KPI. **Distribution** uses the workbook's original ranges and counts, **Recorded samples** plots numeric measurements against their own workbook row positions, and **Source statistics** shows the values as supplied. The source tables are keyboard-accessible and retain every numeric sample, even when a dense plot is downsampled. Their compact page controls sit to the right of the table title inside **View source values** when space allows; multi-page distribution charts also have controls above the image export options.
3. Choose SVG, PNG or JPG, then use **Download plot** or **Download legend** for separate images, or **Download both** for one image with the legend below the plot. **Copy plot to clipboard** copies the plot alone as PNG in supported browsers on HTTPS or localhost. When a KPI spans multiple workbook groups, choose a group to view and export. For distributions split across pages, image exports are for the visible page.
4. Use **Download PowerPoint** to choose the workbooks and KPIs to include, edit the cutoffs, colours and labels of supported map thresholds, and set the workbook order with **Move up** and **Move down**. In **Customise PowerPoint**, turn on **Add a divider slide before each workbook** to add and rename title slides. Blank divider titles use the workbook filename. Dividers require the one-section-per-workbook layout; leave them off to use **Compare workbooks by KPI**. Threshold changes affect this export only, not the explorer or chart-only slides.

The report cover shows the selected logs' date or date range, when available. For each KPI and workbook group with mapped samples, the report uses a map image with a point legend but no separate sector legend. Technology mode uses **Legend**; PCI entries show matched cell names where available. **LTE EARFCN** and **NR-ARFCN** map slides use **Channel number** as the legend heading and show the corresponding downlink frequency in MHz when it can be determined. Outdoor slides use the selected basemap, with attribution on the image; select **No basemap** to avoid tile requests. If tiles cannot be captured, the slide still shows the survey points and notes that the basemap is unavailable. Indoor slides use the floor plan instead of web tiles. Other slides use the existing distribution, recorded samples, or source statistics views. PowerPoint charts and legend text remain editable.

The report uses the Macquarie Group reference's Telstra colour palette, typeface names, widescreen format, and visual-plus-legend layout. It does not copy the original imagery or embed the proprietary typefaces. Install the approved Telstra Display Medium and Telstra Text fonts locally for the intended appearance. The web app has an Arial fallback; PowerPoint may substitute its own fonts.

Distribution counts are not time shares. Missing values are not interpreted as zero. Workbook rows are not aligned across devices, unconfirmed throughput units are left as source units, and a carrier is not inferred from a missing label.

## Maps and serving-cell snapshots

- **Map plot** opens by default when imported or restored workbooks contain a KPI reading with valid GPS coordinates on the same row in `Series Formatted Data`. If the initial KPI has no plottable GPS readings, Surveyor selects the first KPI that does. Workbooks without plottable GPS readings continue to open in a chart or statistics view. The Technology mode map colours points and builds its legend from the `Technology_Mode` values on those rows, not from workbook names or histogram totals. The map can preview a subset of dense data; the accessible source table and KML or Shapefile downloads include every mapped reading in the selected workbook group. These are WGS 84 point exports, not basemap images. The Shapefile ZIP contains `.shp`, `.shx`, `.dbf` and `.prj` files; use `KIND` to distinguish samples and cell markers.
- LTE and NR PCI, EARFCN/ARFCN, cell identities, and other categorical KPIs get a colour and legend entry for each distinct value on a row with valid GPS in the plotted workbook group. The palette prioritises contrast between categories that occur near each other. The map, image legend and PowerPoint use the same colours; long PowerPoint legends continue on following slides.
- Select or double-click a map legend entry to isolate matching points in the map and source table. Use **Show all points** to reset. Percentages are calculated from every mapped sample in the selected workbook group, before filtering or thinning. Continuous colour scales list the exact minimum and maximum readings, not ranges. Map images capture the filtered view; GIS and PowerPoint exports still use the full data.
- Map legends use equal-width columns that adapt to the available space and label length. LTE and NR PCI legend buttons size to fit the full labels, including associated Actix cell names and percentages, and wrap on narrow screens. A PCI reused by multiple cells stays one filter entry. PCI/channel-based names are marked **candidate**; unresolved matches add no name.
- Selecting a PCI reframes the map to fit the isolated samples, the floor plan if present, and the linked cells of the selected technology when the site overlay is enabled. The map keeps its current rotation. **Show all points** fits the full set of samples again.
- Hover over a survey point to see its current KPI reading in a compact label that wraps longer readings. Click or tap a point for the full sample details.
- When one workbook is loaded, supported KPIs use threshold colours automatically. With two or more workbooks, use **Use KPI thresholds** in the map legend to switch from UE colours to shared thresholds for supported KPIs. The choice carries across supported KPIs and workbook groups. 4G RSRP and 5G SS-RSRP use the same coverage bands: Good (blue, ≥ −95 dBm), Moderate (green, −105 to < −95 dBm), Basic (yellow, −115 to < −105 dBm), and No coverage (red, < −115 dBm). SINR uses red below −5 dB, orange from −5 to < 0 dB, yellow from 0 to < 5 dB, bright green from 5 to < 10 dB, and dark green at or above 10 dB. SINR legends show the count and percentage of mapped samples in each band. Downlink POLQA MOS and app throughput retain the Macquarie Group bands, with red for numeric readings below the lowest band. Missing readings are not red. Throughput bands are shown in Mbps, while Nemo source values remain in kbps. Other continuous KPIs use a colour scale labelled with the observed range. GIS point exports include the plotted `COLOR` and the selected `KPI_BAND` where applicable.
- Switching between KPIs in **Map plot** keeps the selected workbook row and map zoom in place. The popup updates to the new KPI, or says no reading is available if that row did not report it.
- Import the Actix LTE and NR CSVs under **Actix serving-cell snapshots**, which starts expanded when no snapshots are loaded. The app extracts the `YYYY-MM-DD` snapshot date from each filename. The date override and maximum gap appear after a snapshot is loaded. If your first file has no date in its name, the override appears after you select it; enter a date and select the file again. A second file of the same technology and date replaces that snapshot. The closest date wins within the selected gap (seven days by default); ties prefer the earlier snapshot. Undated rows use the workbook's date only if it has exactly one observed date.
- The **Sites** section groups the site overlay controls and shows the date or dates of the Actix snapshots selected for the current map. It is hidden when no snapshot applies. Actix snapshots are Telstra-only. Logs without operator evidence are eligible for matching and labeled `Telstra (assumed)` in map details and GIS exports. Telstra's PLMN (`505-01`) or a Telstra device label is shown as `Telstra`. Evidence of another network blocks matching, even if a Telstra label is also present. A shared channel or cell ID never verifies the operator.
- For eligible logs, LTE ECI and NR NCI are matched first. A reported identity carries forward to later samples with the same PCI, until a new identity is reported or the PCI or downlink channel changes. This also works when the handover row has no GPS. Without a reported or carried identity, a same-row PCI and downlink channel can identify candidates; the nearest candidate is shown with its distance and candidate count. A reported or carried identity missing from the chosen inventory stays unmatched; PCI/channel candidates do not prove serving-cell identity.
- Sample pop-ups show only the LTE or NR cell name for each association, using `Cell_Name` when supplied and `Sector_ID` otherwise. The source table retains the detailed association information.
- Survey points only show an outline when hovered or selected. With Actix sites and sectors enabled, hover over a matched point to preview its links, or select it on the map or via **Show on map** in the source table to pin them. Turn off **Show cell links on hover** to hide hover links without affecting selected links or KPI tooltips. Hover links disappear when the pointer leaves the point and are not included in exports. Links end at the midpoint of the matched directional sector's outer arc; omnidirectional cells and cells without usable angles use the site centre. Solid links indicate unique ID matches; dashed links indicate PCI/channel candidates or duplicate IDs.
- Sector symbols use Actix `Azimuth` and `Beamwidth`; a 360° beam is circular, and sectors without usable angles are omitted. Recognised Actix cell or sector codes use the NSWACT Google Earth carrier palette. LTE and 5G NR both use solid sector outlines, and carriers sharing a bearing are drawn in separate bands. Unrecognised codes use a technology-specific fallback and are labelled **carrier unknown**. The map and its image exports have a separate Actix sector legend when those overlays are enabled. The symbols are screen-sized, not coverage footprints. The reference KML files are not required at runtime, and KML and Shapefile downloads remain point exports.
- When **Show Actix sites and sectors** is enabled, **Size** adjusts site markers and sectors, and **Transparency** fades those symbols and their labels. Survey points are unaffected. Map images and PowerPoint map slides use the same settings.
- On an LTE or NR PCI map, enable **Match cell colours to PCI legend** in **Sites** to colour individual sectors for the selected technology by their Actix PCI. Sectors with no matching legend entry and sectors from the other technology keep their carrier colours. Map images and PowerPoint map slides use the same setting.
- On a PCI map, **Show only detected cells** limits the overlay to cells of the selected technology linked to visible samples. Isolating a PCI in the legend hides sibling sectors unless they are also linked to the remaining samples. Map images reflect this filter; GIS and PowerPoint exports are unchanged.
- The Actix sector legend groups channel codes by LTE and NR, with nominal MHz bands where the reference identifies them. Site labels move around visible survey points, sector symbols and other labels. A label is hidden when no nearby position fits and can reappear after zooming, panning or filtering.
- **Keep imports in this browser across refreshes** saves parsed workbooks, Actix snapshots and floor plans in local browser storage. It is off by default. Turn it off to remove the saved copy without clearing the current view, or use **Clear survey**, **Clear snapshots** and **Clear floor plans** to remove individual import types from both the app and its saved workspace.

- The map labels each plotted Actix site with its site code, once per site location even when several matched cells share it.

### Indoor floor plans

- Under **Indoor floor plans**, select a MapInfo raster `.tab` file together with the floor-plan image it names (`.bmp`, `.png` or `.jpg`) and, optionally, its Nemo `.mrk` marker file. Several plans can be imported at once; each `.tab` is matched to its image by name, and to an `.mrk` with the same name (or the only `.mrk` when one plan is imported). Images are decoded in a background worker and reduced to at most 4096 px.
- A georeferenced `.tab` (`CoordSys Earth Projection 1`) places the plan, including rotation, on the selected basemap. A non-georeferenced `.tab` (`NonEarth`, e.g. metres) uses a blank basemap; Actix matching, the Actix overlay and KML/Shapefile downloads are unavailable for that plan because its coordinates are not geographic.
- With markers, every workbook row is spread evenly along the marker path in row order, so the walk is assumed to be at a constant pace. Without markers, rows use the workbook's longitude/latitude (or plan x/y for non-georeferenced plans). Marker files written in image pixels are detected automatically.
- New plans are assigned to workbooks whose GPS points mostly fall inside the plan (or that have no GPS for non-georeferenced plans). Change or remove the assignment with the **Floor plan** selector beside each imported workbook. Workbooks on different plans are shown in separate map groups and PowerPoint map slides, with the plan name in the slide label; map images and slides include the floor plan.
- Workbooks saved before floor-plan support only kept rows with GPS; re-import them to spread every row along the markers.

### Map rotation

- The on-map zoom and rotation controls use the same light and dark themes and keyboard focus indicators as the rest of Surveyor. At the default text size, they are 32 × 32 CSS pixels, or 36 × 36 on touch-first devices.
- Use the rotation buttons under the zoom control to turn the map 15° at a time (hold Shift for 1°). The compass between them shows the current rotation: drag around it to turn the map at half the pointer's angular speed, or select it to return to north up. With the compass focused, arrow keys turn 1° (Shift: 0.1°), Page Up/Down turn 15° and Home returns to north up. Shift + mouse wheel and a two-finger twist on touch screens also rotate the map.
- When a floor plan is shown, **Align to floor plan** turns the map so the plan's top edge is level.
- Each floor plan remembers its own rotation (saved with the plan when imports are kept); maps without a plan share one rotation for the session. Map image downloads, clipboard copies and PowerPoint map slides use the chosen rotation. Site labels and cell markers stay upright; sector symbols turn with the map.

### Floor plan display

- The **Floor plan** panel above the map sets the plan's transparency. It is saved with the plan and applies to map downloads and PowerPoint slides.
- With **No basemap (floor plan only)** selected, or for a plan that is not georeferenced, the floor plan becomes the basemap on a plain white background. The panel then asks you to confirm the plan's orientation, with a degree field, a 0.1° slider and −90°/−1°/−0.1°/+0.1°/+1°/+90° steps. Select **Orientation is correct** to save it. PowerPoint centres and scales the cropped plan in the slide's map area, keeps the KPI points, and omits web tiles and site overlays. It uses the saved rotation, or aligns the plan's top edge if no rotation has been set.

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

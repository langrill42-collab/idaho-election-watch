# Idaho Election Watch

A local Mac election desk for November 3, 2026. Coverage opens with all 105 Idaho legislative races, followed by statewide offices and questions, then Ada County and ACHD. Ada judicial races and retention questions are excluded. There are no forecasts or win probabilities.

Double-click **Idaho Election Watch.app** or **Election Watch.command** in this folder. The window uses a server bound to `127.0.0.1:8766`. Closing its owning window stops the server. To run in a browser instead:

```sh
uv run python app.py --serve
```

Then open <http://127.0.0.1:8766>. Python dependencies are pinned in `uv.lock`.

## Using the desk

- Switch between Map and List without losing the selected race. Senate, House A and House B share the same legislative geography.
- The first legislative map shows the explicitly labeled **2024 baseline**. Choose **2026 returns** to view current reported leaders. Use **Zoom to district** to inspect dense urban districts.
- The list includes all three legislative seats and can sort by historical/current margin or reported fundraising. Race-level fundraising sums identify how many candidates have matched figures.
- Stars and notes persist locally in the current window/browser profile. The native Mac window keeps its profile in `data/window/`; a separate browser has its own notes.
- Results refresh every minute while the app is running. Sunshine totals refresh hourly. Source publication time and retrieval time are shown separately. A failed fetch retains the last valid data and displays the error.

## Data and interpretation

- **Current results and candidates:** [SOS public JSON](https://results.voteidaho.gov/cdn/results/id/export-nov2026.json). State/district totals come from the aggregate section. County sections supply geographic breakdowns and county-only contests; they are never added again to aggregate totals. The interface labels all current returns unofficial and makes no winner calls.
- **2024 history:** [SOS all-races workbook](https://archive.sos.idaho.gov/elections/data/results/2024/raw_races_general.xlsx). Candidate votes are summed across precincts, excluding overvotes/undervotes. All 105 legislative contests are matched. Other contests show history only when a comparable record is loaded; 2022 statewide-office history has not been loaded. Ballot questions are not matched across years merely by proposition number.
- **Fundraising:** [Idaho Sunshine](https://sunshine.voteidaho.gov/campaignfinance/) public `GetCandidateDetails` API, filtered to 2026 candidate registrations. Raised, spent and cash balance are the source's running figures, not a single monthly report. Cash may include carry-in; independent expenditures are excluded. Retrieval time is not a report-through date. Missing matches remain blank. Federal fundraising is not supplied by Sunshine.
- Finance matches require office, election cycle, district/seat and candidate identity. `data/finance-aliases.json` records name variants reviewed against the official roster and Sunshine registrations. Alias matches still require the correct office/district/seat. Ambiguous registrations are not assigned automatically.
- **Legislative boundaries:** [Idaho's official ArcGIS service](https://services1.arcgis.com/CNPdEkvnGl65jCX8/ArcGIS/rest/services/Congressional_and_Legislative_Districts_in_Idaho/FeatureServer/1), 2021 reapportionment, downloaded in WGS84 and simplified for display.
- **County boundaries:** [Idaho Transportation Department layer 25](https://gis.itd.idaho.gov/arcgisprod/rest/services/ArcGISOnline/AdminBoundaryLayers/MapServer/25), WGS84. The app renders legislative or county boundaries without a remote basemap or map-tile service.
- The SOS-linked 2026 Ada precinct geometry is cached for future detail; the current interface renders county geography for local races.
- **ACHD:** 2026 zones 3 and 4 are elected countywide. Zone numbers indicate candidate residence. A prior zone result is not presented as a comparable countywide margin. [Official ACHD statement](https://content.govdelivery.com/bulletins/gd/IDACHD-42b4e9d?wgt_ref=IDACHD_WIDGET_2).

The live endpoints are public application exports, not guaranteed versioned API contracts. Unexpected/incomplete results retain the previous valid snapshot. New source snapshots are saved as compressed JSON in `data/snapshots/`; this version does not include a replay interface.

## Local checks

```sh
uv run python -m unittest discover -s tests -v
node --check static/app.js
```

The data tests cover total-vs-county separation, awaiting-vs-reported zero, House seat identity, local contest IDs, vote denominators, and finance identity/ambiguity. Browser checks cover navigation, map/list selection, filters, sorting, watchlist/notes persistence, source links and smaller-window layout.

Leaflet 1.9.4 is vendored locally; its license is in `static/vendor/LICENSE`. All application code, caches and preferences stay on this Mac. Network requests retrieve official election/finance data; clicking source links opens the corresponding official page.

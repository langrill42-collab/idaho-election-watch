# Idaho Election Watch

A local Mac election desk for November 3, 2026. Coverage opens with all 105 Idaho legislative races, followed by statewide offices and questions, then Ada County and ACHD. Ada judicial races and retention questions are excluded. Legislative races have preliminary pre-election rating buckets; the interface does not display numerical win probabilities or make winner calls.

Double-click **Idaho Election Watch.app** or **Election Watch.command** in this folder. The window uses a server bound to `127.0.0.1:8766`. Closing its owning window stops the server. To run in a browser instead:

```sh
uv run python app.py --serve
```

Then open <http://127.0.0.1:8766>. Python dependencies are pinned in `uv.lock`.

## Using the desk

- Switch between Map and List without losing the selected race. Senate, House A and House B share the same legislative geography.
- The legislative map opens with **Race ratings**, colored by the favored party and rating strength. Choose **2024 baseline** for historical winners or **2026 returns** for current reported leaders. Use **Zoom to district** to inspect dense urban districts.
- The list includes all three legislative seats and can sort by historical/current margin or reported fundraising. Race-level fundraising sums identify how many candidates have matched figures.
- Filter by rating or sort the list by competitiveness. In a race’s **Pre-election rating** card, use **Set your rating** to select a bucket and favored candidate and record a reason. Your override is marked with an asterisk; the original model assessment remains visible. **Use model rating** removes the override. Drafts survive automatic refreshes; saved overrides persist across relaunches in the same native window/browser profile.
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

## Preliminary legislative model

The model uses official **2024 and 2022** results, with 2024 carrying two-thirds of the weight and 2022 one-third when both years have comparable evidence. Each year is evaluated separately before blending. One usable year receives the full weight. Both historical results appear in the race detail panel, even if a result was unopposed and could not support a rating.

The [2022 SOS canvass archive](https://archive.sos.idaho.gov/elections/data/results/2022/2022_General_Canvass.zip) supplied all 105 legislative contests and 169 candidates. Candidate totals independently agree across precinct sums, precinct published totals, county sums, and county published totals. `data/history-2022-validation.json` records source anomalies and the comparison with 2024. County workbook seat labels resolve a duplicated House A heading in District 22’s precinct workbook; the precinct party header supplies a missing county party label for Gregory T Holtz. Fifty 2022 races were unopposed. Both years use the [post-2021 legislative districts](https://voteidaho.gov/redistricting/).

Before considering history, legislative races with **exactly one Republican or Democratic candidate** default to **No real contest** for that candidate, even with independent or minor-party opponents. This is a user-directed working assumption, not a historical probability estimate. It applies to two-candidate and larger fields, and manual overrides still take precedence. A sole listed candidate remains **Unopposed**.

For other supported races, in each year:

- Republican–Democratic races use their R-minus-D margin, divided by those two parties’ combined votes. Both parties must have positive votes and together account for at least 95% of the historical candidate vote. Unopposed races never imply overwhelming support against a new opponent.
- The same seat gets 75% of the within-year weight when its candidate field is unchanged and 50% when it changes. The median margin of other comparable legislative seats in the same district supplies the remainder. Without peer evidence, use the seat alone; without seat evidence, use the district alone. Historical candidate names and parties must match for continuity; ambiguous spelling changes conservatively count as a changed field.
- Initial margin standard deviations are 12 points for unchanged candidates, 16 for changed candidates, and 20 for district-only evidence. Half the seat-versus-peer margin difference is added in quadrature. Cycle standard deviations are averaged using the historical weights; half the difference between cycle baselines is then added in quadrature. Two years are not treated as independent observations that automatically narrow uncertainty. A 2022-only baseline has at least 20-point uncertainty.
- A non-R–D matchup is modeled only when the same two candidates contested that seat in the historical year, using their margin and 16-point uncertainty. New independent/minor-party matchups and multi-candidate fields remain unrated unless the single-major-party assumption applies. One listed candidate is **Unopposed**, a roster status rather than a forecast.

The estimated margin and uncertainty define a normal distribution. The implied underdog win chance selects the bucket: toss-up at 40–50%; likely at 25–under 40%; very likely at 5–under 25%; longshot at 1–under 5%; no real contest below 1%. Longshot refers to the opposition; map color always identifies the favored party. Exact odds are not displayed. Ties in the baseline are toss-ups with no favored candidate.

These weights and uncertainty values are **starting assumptions, not calibrated probabilities**. Thirty-three comparable R–D seats were contested in both years; their root mean square margin change was 6.68 points and mean change was 3.94 points toward Republicans. This is one cycle transition, with changing candidates and selective coverage, not an independent validation of 2026 win chances. No 2026 swing or polling adjustment is assumed. Fundraising remains context because reporting periods are not yet comparable. Current vote totals never enter the pre-election model.

Overrides stay in local storage under `idaho-watch-ratings`; they do not overwrite the model, and they are applied only while the candidate roster matches. Statewide and Ada contests remain outside the automatic model. All ratings are assessments, not official results or winner declarations.

## Local checks

```sh
uv run python -m unittest discover -s tests -v
node --check static/app.js
```

The data tests cover total-vs-county separation, awaiting-vs-reported zero, House seat identity, local contest IDs, vote denominators, and finance identity/ambiguity. Browser checks cover navigation, map/list selection, filters, sorting, watchlist/notes persistence, source links and smaller-window layout.

Leaflet 1.9.4 is vendored locally; its license is in `static/vendor/LICENSE`. All application code, caches and preferences stay on this Mac. Network requests retrieve official election/finance data; clicking source links opens the corresponding official page.

For the browser persistence regressions, run `node tests/browser_ratings.cjs` with Playwright available. `ELECTION_WATCH_URL` can select a local test server, and `ELECTION_WATCH_PLAYWRIGHT_PATH` can point to an existing Playwright installation. The tests use an isolated browser profile and do not modify the Mac app’s saved ratings.

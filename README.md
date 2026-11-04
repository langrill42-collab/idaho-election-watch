# Idaho Election Watch

An election desk for November 3, 2026, available on this Mac and on GitHub Pages. Coverage opens with all 105 Idaho legislative races, followed by statewide offices and questions, then Ada County and ACHD. Ada judicial races and retention questions are excluded. Legislative races have preliminary pre-election rating buckets; the interface does not display numerical win probabilities or make winner calls.

## Website

[Open Idaho Election Watch](https://langrill42-collab.github.io/idaho-election-watch/).

The website is designed for phones. Its default list uses full-width race cards with candidates, party, pre-election rating, historical context, and reported fundraising. Search and the Saved, Filters, and Map/List controls stay within reach while scrolling. Senate, House A, and House B can be filtered separately. On wider screens, cards sit beside the race details.

Tap a race to open a dedicated detail screen. **Back to races** restores your filters and list position; your browser's Back button works too. A race URL such as `#race=sen15` opens that race directly. Details include 2024 and 2022 results, candidate finance cards, browser-local notes, and rating factors at the bottom. **View on map** opens the selected race's geography. Statewide and Ada maps have a contest selector. These website styles are separate from the Mac app's layout.

GitHub Pages serves the interface and public JSON snapshots. A GitHub Actions workflow fetches official results from GitHub's runners between **9 p.m. Mountain on November 3 and 1 a.m. Mountain on November 4, 2026** (8 p.m. to midnight Pacific). It is scheduled every five minutes, with a minimum five-minute gap after the previous successful retrieval. [GitHub can delay scheduled jobs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), and publishing adds some delay. A delayed automatic job cannot fetch official data at or after the cutoff. The source and retrieval timestamps identify the snapshot being shown. Sunshine totals refresh hourly during this window.

The website checks for published snapshots every five minutes during that same window, then switches to manual refresh. Its refresh button loads the latest published snapshot; it does not contact the SOS or start a new collection job. To collect and publish new official results after 1 a.m., run **Publish Election Watch** manually in the repository's Actions tab. Manual workflow runs bypass the overnight cutoff while retaining the poll-close and five-minute minimum-interval limits. The command-line equivalent is `python publish_site.py --manual-refresh --previous-site https://langrill42-collab.github.io/idaho-election-watch/`.

Notes, watchlists, and manual rating overrides stay in the visitor's browser. They are not uploaded or shared, and your desktop profile is not included in the site. The exported data includes the public candidate roster, results, finance figures, and the preliminary model's ratings and assumptions.

The build restores the newer of its cached results and the last deployed snapshot before fetching. Results and finance data are cached before deployment, so a failed deployment can retry the saved results without another official request. A failed official request retains the last valid snapshot. Failure to retrieve the published snapshot, except for a first-deployment 404, stops publication and leaves the existing site available. `data/seed/` supplies public snapshots for the first build. Only `_site/` is deployed, containing the interface, public results, and boundaries.

To build a static preview without contacting official sources:

```sh
python3 publish_site.py --output /tmp/election-preview/idaho-election-watch
python3 -m http.server 8877 --bind 127.0.0.1 --directory /tmp/election-preview
```

Open <http://127.0.0.1:8877/idaho-election-watch/>. The output directory must be new. The publisher uses only the Python standard library; GitHub does not install desktop dependencies.

## Mac app

Double-click **Idaho Election Watch.app** or **Election Watch.command** in this folder. The window uses a server bound to `127.0.0.1:8766`. Closing its owning window stops the server. To run in a browser instead:

```sh
uv run python app.py --serve
```

Then open <http://127.0.0.1:8766>. Python dependencies are pinned in `uv.lock`.

## Using the desk

- The app opens in **List** view. Click an office name or anywhere in its row to load the race details on the right; the office button also supports keyboard selection. Switch between Map and List without losing the selected race. Senate, House A and House B share the same legislative geography.
- When you switch to Map, the legislative map uses **Race ratings** by default, colored by the favored party and rating strength. Choose **2024 baseline** for historical winners or **2026 returns** for current reported leaders. Use **Zoom to district** to inspect dense urban districts.
- The list includes all three legislative seats and can sort by historical/current margin or reported fundraising. Race-level fundraising sums identify how many candidates have matched figures.
- Filter by rating or sort the list by competitiveness. In the **Pre-election rating** card at the bottom of a race’s details, below its historical results, use **Set your rating** to select a bucket and favored candidate and record a reason. Your override is marked with an asterisk; the original model assessment remains visible. **Use model rating** removes the override. Drafts survive automatic refreshes; saved overrides persist across relaunches in the same native window/browser profile.
- Stars and notes persist locally in the current window/browser profile. The native Mac window keeps its profile in `data/window/`; a separate browser has its own notes.
- Opening the app loads saved data. Automatic requests stay paused until **November 3, 9 p.m. Mountain / 8 p.m. Pacific**, the [SOS results start time](https://voteidaho.gov/idaho-general-election/). Results then refresh every **five minutes** while the app is running, with hourly Sunshine updates, until **November 4, 1 a.m. Mountain**. Automatic requests remain off after that cutoff, including after relaunch. The refresh button can request results manually at any time. Additional windows read the shared local cache. Source publication time and retrieval time are shown separately. A failed fetch retains the last valid data and displays the error.

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

For Republican–Democratic races, the **final baseline margin shifts a full five points toward Democrats after blending**: R+10 becomes R+5. The full five-point adjustment applies whether both years, only 2024, or only 2022 supply the baseline. This changes the expected margin, while uncertainty continues to use the unadjusted historical differences. Historical vote totals and the historical map remain as reported.

Before considering history, legislative races with **exactly one Republican or Democratic candidate** default to **No real contest** for that candidate, even with independent or minor-party opponents. This is a user-directed working assumption, not a historical probability estimate. It applies to two-candidate and larger fields, and manual overrides still take precedence. A sole listed candidate remains **Unopposed**.

For other supported races, in each year:

- Republican–Democratic races use their R-minus-D margin, divided by those two parties’ combined votes. Both parties must have positive votes and together account for at least 95% of the historical candidate vote. Unopposed races never imply overwhelming support against a new opponent.
- The same seat gets 75% of the within-year weight when its candidate field is unchanged and 50% when it changes. The median margin of other comparable legislative seats in the same district supplies the remainder. Without peer evidence, use the seat alone; without seat evidence, use the district alone. Historical candidate names and parties must match for continuity; ambiguous spelling changes conservatively count as a changed field.
- Initial margin standard deviations are 12 points for unchanged candidates, 16 for changed candidates, and 20 for district-only evidence. Half the seat-versus-peer margin difference is added in quadrature. Cycle standard deviations are averaged using the historical weights; half the difference between cycle baselines is then added in quadrature. Two years are not treated as independent observations that automatically narrow uncertainty. A 2022-only baseline has at least 20-point uncertainty.
- A non-R–D matchup is modeled only when the same two candidates contested that seat in the historical year, using their margin and 16-point uncertainty. New independent/minor-party matchups and multi-candidate fields remain unrated unless the single-major-party assumption applies. One listed candidate is **Unopposed**, a roster status rather than a forecast.

The estimated margin and uncertainty define a normal distribution. The implied underdog win chance selects the bucket: toss-up at 40–50%; likely at 25–under 40%; very likely at 5–under 25%; longshot at 1–under 5%; no real contest below 1%. Longshot refers to the opposition; map color always identifies the favored party. Exact odds are not displayed. Ties in the baseline are toss-ups with no favored candidate.

These weights and uncertainty values are **starting assumptions, not calibrated probabilities**. Thirty-three comparable R–D seats were contested in both years; their root mean square margin change was 6.68 points and mean change was 3.94 points toward Republicans. This is one cycle transition, with changing candidates and selective coverage, not an independent validation of 2026 win chances. The full five-point Democratic margin shift after blending is a user-directed working assumption. No polling adjustment is assumed. Fundraising remains context because reporting periods are not yet comparable. Current vote totals never enter the pre-election model.

Overrides stay in local storage under `idaho-watch-ratings`; they do not overwrite the model, and they are applied only while the candidate roster matches. Statewide and Ada contests remain outside the automatic model. All ratings are assessments, not official results or winner declarations.

## Local checks

```sh
uv run python -m unittest discover -s tests -v
node --check static/app.js
```

The data tests cover total-vs-county separation, awaiting-vs-reported zero, House seat identity, local contest IDs, vote denominators, and finance identity/ambiguity. Browser checks cover navigation, map/list selection, filters, sorting, watchlist/notes persistence, source links and smaller-window layout.

Leaflet 1.9.4 is vendored locally; its license is in `static/vendor/LICENSE`. The Mac app keeps its caches and preferences locally and retrieves official election/finance data directly. The website loads published snapshots from GitHub Pages. Clicking source links opens the corresponding official page.

For the browser persistence regressions, run `node tests/browser_ratings.cjs` with Playwright available. `ELECTION_WATCH_URL` can select a local test server, and `ELECTION_WATCH_PLAYWRIGHT_PATH` can point to an existing Playwright installation. The tests use an isolated browser profile and do not modify the Mac app’s saved ratings.

Run `node tests/browser_pages.cjs` against the static preview for phone navigation, shared race links, scroll restoration, maps, filters, all coverage tabs, reporting/error states, snapshot-only refresh, private notes/drafts, and widths from 320 to 1500 pixels. The same Playwright and URL environment variables apply. Set `ELECTION_WATCH_BROWSER=webkit` to run the same checks with WebKit.

Run `node tests/browser_schedule.cjs` against the static preview to simulate the opening and cutoff times, a suspended tab waking after 1 a.m., and manual refresh after automatic checks end. These checks use a frozen browser clock and intercepted snapshots; they never fetch official results.

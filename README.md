# osrs-planner

The OSRS route planner at [osrs.collisionlab.world](https://osrs.collisionlab.world): a React
frontend and a Java route service, shipped as one release image.

The service plans routes with [shortest-path-tooling](https://github.com/osrs-pathfinding/shortest-path-tooling)'s
`:accounts` and `:routing` projects, on the plugin version tooling pins. Tooling is the `tooling/`
submodule and is included in this Gradle build.

## Develop

```sh
git clone --recursive git@github.com:collisionlab/osrs-planner.git
nix develop
gradle :service:run                       # route service on :8080
npm install && npm run dev                # frontend on :5173, proxies /api to the service
```

Tests: `gradle :service:test` and `npm test`.

The workbench's [Transport candidates queue](docs/transport-candidates.md) at
`/candidates` reviews 246 pinned BestPath geometry suggestions against bundled
transport data and the existing inset map. The guide covers offline regeneration
and the checked-in review ledger.

## Layout

| Path | Contents |
|---|---|
| `src/` | Frontend (React, TypeScript, Vite) |
| `service/` | Route service (Javalin): `/v1` API, `/live`, `/ready`, `/metrics`, `/version`; serves the built frontend when `FRONTEND_DIR` is set |
| `service/src/main/java/shortestpath/routeapi/` | Route API contract (moved from tooling's `:routing`) |
| `service/src/main/java/shortestpath/workbench/` | The workbench's API: pull request reviews, the transport catalogue, provenance |
| `src/features/workbench/` | The workbench pages, served on `workbench.` hosts |
| `schemas/` | The route API and account contracts (`route-api-v1`, `account-v1`) |
| `tooling/` | shortest-path-tooling (submodule), pinned to upstream `master` |
| `Dockerfile` | The release image |

## End-to-end tests

`e2e/` holds Playwright tests of the planner UI, mostly the inset map: floors opened from a
staircase, stacked glider floors whose labels never overlap, area search, live drag, account
edits, and two whole-map screenshots.

```bash
nix develop -c npm run e2e                          # all of them (CI runs this too)
nix develop -c npm run e2e -- e2e/insets.spec.ts    # one file
nix develop -c npm run e2e -- --update-snapshots    # after an intended visual change; review the PNGs
nix develop -c npx playwright show-trace test-results/<test>/trace.zip   # a failure, step by step
```

The dev shell provides Chromium (Nix's `playwright-driver`; keep `@playwright/test` at that
version). The route API is mocked in the browser from `e2e/fixtures`: recorded routes for the
scenarios in `e2e/fixtures/scenarios.json`, and a straight walk for any other route. Re-record
after an API or routing change with a local service running:
`nix develop -c node scripts/record-e2e-fixtures.mjs`. Map tiles and inset assets load from
tiles.collisionlab.world at the pinned versions, which never change. In development builds the
inset map exposes `window.insetMap.pixel(tile)` so tests can click world tiles.

## Keeping in step with the plugin

The planner's options come from the plugin's own config (`ShortestPathConfig`) through
`GET /v1/catalog`, so a plugin update can't silently leave the web UI behind. Bumping the
`tooling` submodule runs these guards:

- `PlannerSettings` puts every routing setting in a group (everyday, transport, threshold,
  advanced). A setting it doesn't place stops the catalog from building.
- Plugin settings that describe the account (unlocks the game doesn't report) are account
  `Unlock`s of kind `SETTING`, not route settings.
- `CatalogNames` names every unlock; `CatalogTest` fails on a missing name.
- `RouteSchemaTest` checks the served catalog against `route-api-v1.schema.json`.
- `RequirementCoverageTest` fails when a transport needs a game variable no account fact sets,
  beyond the reviewed `KNOWN_GAPS`.

The frontend keeps no lists of setting keys: it shows settings by the catalog's group and names.

## Route logs

Every `POST /v1/route` writes one JSON log line from the `route` logger. It records the endpoints, the
account (a preset id, or `custom` with a short hash of the account), the changed settings, the
outcome, the legs the route takes, and the search's counters and phase timings. These are under
`search`: cache hits, `nodesChecked`, the exact search's `phasesMs` and `forward` counters.
`trigger` is `drag` for the provisional routes the map asks for while an endpoint is being dragged.
`country` comes from Cloudflare's `CF-IPCountry`. Neither IP addresses nor custom accounts are logged.

On the app host (Tailscale SSH):

```sh
journalctl -u 'planner-*' -o cat --since today | jq -c 'select(.logger_name == "route")'
# slowest searches today
journalctl -u 'planner-*' -o cat --since today | jq -s -c 'map(select(.logger_name == "route" and .search.searchMs))
  | sort_by(-.search.searchMs) | .[:20][] | {from, to, account, ms: .search.searchMs, nodes: .search.nodesChecked}'
```

`/metrics` adds `route_requests_total` and `route_duration_seconds` by `outcome`
(`reachable`, `unreachable`, `invalid`, `timeout`, `busy`, `error`), `route_cache_lookups_total`
and the `route_search_nodes` histogram.

## Releases

[docs/deployment.md](docs/deployment.md) maps every flow that changes production: which pin each job
moves, when, and what merges without review. `scripts/pin-status` shows whether each pin is current.

Every push to `main` builds `ghcr.io/collisionlab/osrs-planner:<commit>` and opens a PR in
`collisionlab/infra` pinning its digest (`scripts/pin-release`). Merging that PR deploys it to the
`app` host blue/green: the new release starts beside the old one and takes traffic only after it is
ready and passes smoke checks.

`tooling` follows upstream shortest-path-tooling's `master`. Each day `bump-tooling.yml` runs
`scripts/bump-tooling`, which opens (or refreshes) a collisionlab-bot `pin/tooling` PR moving the submodule
to master's head; it merges itself once CI passes, and so releases. When the guards above fail, push the
planner fixes to `pin/tooling`; the job leaves a branch with other people's commits alone. Run it early
with `gh workflow run bump-tooling -R collisionlab/osrs-planner`.

The planner owns its contracts in `schemas/`: `route-api-v1` and the `account-v1` it references.

## Workbench

Tools for people working on the plugin's data, on `workbench.collisionlab.world` (any `workbench.`
host): the **transport review** of a pull request (`/github/<owner>/<repo>/pull/<n>`), and the
**transport explorer** (`/transports`). Both draw over the inset map through a small feature overlay
(`src/map/insets/features.ts`): edges, tiles and counted areas, each with the key of the item it
belongs to. The overlay's *anchors* (a review unit's rows, the explorer's selected transport) decide
which areas are laid out as insets and where the view opens, and collision is drawn around them;
other features are drawn only where their tiles already are on the map. A route stays a route: the
workbench never builds a `RoutePlan` to draw transports.

The explorer reads the plugin the service bundles. `TransportCatalog` loads each transport file
through the plugin's own `ResourceLoader.addTransportsFromContents` and applies its house remapping,
which is exactly `PluginResources.transports()` (`TransportCatalogTest` checks the two match), and
traces every effective transport to the rows it came from: one row, an origin row paired with a
destination row (fairy rings and other networks), or a teleport's row (no origin is made up). The
API answers a view at a time, `GET /api/workbench/v1/transports?view=plane,x1,y1,x2,y2;...` (a box
per area drawn), listing at most 2,500 transports and otherwise only counting them; also `/meta`,
`/search?q=` (object id, `x y plane`, or text) and `/<id>`. URLs keep the selection, place, type
filter and search (`?t=…&at=x,y,plane&z=…&types=…&q=…`). The explorer draws transports on their
tiles, in map units, and only once zoomed in to 4 pixels a tile; further out it draws none, since a
count per area says nothing. A hop between neighbouring tiles (a door) is one bar over their edge.
Networks (fairy rings, spirit trees, charter ships, canoes, minecarts and the like: one connected
part of a type each) come with the view as stations and a hub at the middle of their surface
stations; each station in view is joined to its hub rather than to every other station. A station's
several tiles are one station, named by what the transports arriving there call it.

The explorer's banks layer reads the plugin's `destinations/game_features/bank.tsv` through
`GET /api/workbench/v1/banks` (all at once): tiles of one name close together are one bank, with
what any of them needs. Bank tiles are drawn like transport tiles, outlined where a bank needs a
quest, skill or unlock.

Every page says where its layers come from. The service records the tooling and plugin commits it
was built with (`TOOLING_REV`/`PLUGIN_REV` in the image build, else git); collision comes from the
tiles release's `collision/<version>/manifest.json`, which names the tooling commit that dumped it.
When the two tooling commits differ the footer says so rather than implying the walls drawn are the
plugin's; a review's collision is never from the pull request, and its footer says that too.

The **inset investigation** (`/insets`) is for areas off the main map: an area browser (curated area
keys and provisional, unnamed regions, ordered by outstanding issues), the shared inset map, and a
details panel in two modes over the same selection and view. *Topology* lists the release's
entrances and connections, the transports on the area's terrain, the tooling's walking components,
candidate links and suspect ends, and drafts a candidate `transports.tsv` row from two tiles, with
every field it can't know marked `INVESTIGATE(…)`. *Labelling* lists names, regions, accepted
evidence, suggested names, anchor chains and issues, and drafts an `annotations.json` area entry
from what the developer chose. Nothing is written anywhere. The overlay's `regions` show inset
regions by id: beside their entrance (as the planner does) when asked and one is known, else where
they really are, joined to nothing; another floor's region goes beside the shown ones. A `mask`
feature tints a region's exact terrain.

Its data (`src/features/workbench/investigation/`):

- the pinned inset release: `regions.json`, `labels.json` (with its evidence), `anchors.json`,
  `review.json`, each checked against the release's manifest;
- `investigations.json` from the same release, when osrs-tiles publishes it (schema 1, in `data.ts`):
  areas, name candidates, suggested evidence and issues. Its `catalogueSha256`, `labelsSha256` and
  `anchorsSha256` must be this release's, and every region and evidence id must resolve; otherwise
  it is refused and areas come from the labels;
- shortest-path-tooling's topology report (schema 1, in `topology.ts`), served by
  `GET /api/workbench/v1/topology` from the file `WORKBENCH_TOPOLOGY` names or
  `workbench-topology.json` on the classpath, 404 without one. It is joined to regions only by
  tiles, and its conclusions are marked unverified unless its cache, plugin commit and collision
  dumper match the insets', the explorer's and the map's. Without it the page says diagnostics are
  unavailable; it never floods anything itself.

URLs keep the area, region, mode, selected item, plane, view and release
(`?area=…&region=…&mode=labelling&sel=…&plane=…&at=…&z=…&v=…`). The fixtures in
`e2e/fixtures/insets/` follow both contracts and name real regions of the pinned release.

## Route insets

The shared OpenLayers renderer is in `src/map/insets/`. It consumes the live
`RoutePlan`; the gallery at `/experiments/map-lab/` exercises the same renderer
with saved routes and an underground-only regression case. Geometry and
placement do not depend on fixture names or reviewed labels. Placement follows
physical crossings in the actual route. Teleports keep their own route styling
and do not claim a physical entrance.

`tiles.json.insets` pins `{version, tileVersion}` from the `osrs-tiles` sidecar.
It stays `null` until a validated bundle has been published. Once pinned, the
**Insets** control enables the new map, or use `?insets=1` for initial review.
The normal map remains available during rollout. Inset code loads only when
needed. The default stays on the existing map for this first integration.

Areas a route doesn't reach can be shown too. Search for one in the **Area** box, or zoom in to
level 8 or closer and click a surface entrance marker. The area is drawn beside the entrance, and
clicking inside it places A or B there. The named areas and their entrances come from the
release's `anchors.json`, which is fetched only once the inset map is open. Small upper floors (at most
96 tiles across) a route climbs to are drawn as insets beside their building, stacked in plane
order, so a route that only changes plane is not drawn on top of the ground floor. A floor grows
to cover the route's tiles on it that its visible terrain misses (the Grand Tree's branches). To
pick a point upstairs without a route, click an up-arrow marker on a ladder or staircase (zoom 8 or
closer): the floor it leads to, and the floors above that further links reach, open beside it.
The markers come from the route service's `GET /v1/plane-links` (the plugin's physical transports
that change plane in place), so a floor no transport reaches is never offered.

Insets are cut from the pinned pyramid of the selected style (standard or tactical), and the
inset map's surface comes from that same pyramid so the two line up. The pyramid has every plane:
plane 0 at Explv's addresses and upper floors under `p1/`–`p3/`. The inset bundle is metadata only.
Both are described in osrs-tiles' `docs/tiles.md`.

Runtime checks schemas, release versions, content hashes and label compatibility before
rendering. Unknown terrain and unavailable assets are reported without changing
routing coordinates; an asset error offers the existing map as a fallback.
Dynamic instance remapping is not supported; coordinates remain static world
coordinates. Labels with uncertain identity use an explicit coordinate fallback.

`scripts/check-map-assets` validates the pin and required native coverage in CI.
`public/map-assets.json` is generated by the normal contracts step and exposes
the exact deployed pin to rollout/uptime checks. Do not edit it manually.

Merge/deploy order: planner integration first (insets unpinned), infrastructure
CORS/health checks second, tile-sidecar workflow third, then review the initial
asset pin. Routine validated updates subsequently merge through the existing
bot/release flow. Substantial terrain changes wait in draft for review.

Frontend regressions run with `npm test`; `npm run build` includes both the
planner and gallery. The map implementation and fixtures came from tooling
`experiment/map-insets` commit `66b1bff`.

The fixture catalogue contains only the 44 components touched by the saved
routes. These routes are shared by the layout tests and gallery; no separate
case list needs maintaining. They are historical regressions, not release data,
and do not need refreshing when the game cache changes. Runtime catalogues are
generated from the current cache by the sidecar.

The Inset Investigation workbench also shows the pinned production routing graph's
[routing partitions and structural negative mask](docs/routing-layers.md).

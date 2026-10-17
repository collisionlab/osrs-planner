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

## Layout

| Path | Contents |
|---|---|
| `src/` | Frontend (React, TypeScript, Vite) |
| `service/` | Route service (Javalin): `/v1` API, `/live`, `/ready`, `/metrics`, `/version`; serves the built frontend when `FRONTEND_DIR` is set |
| `service/src/main/java/shortestpath/routeapi/` | Route API contract (moved from tooling's `:routing`) |
| `tooling/` | shortest-path-tooling (submodule), with its `corpus/schemas` contracts |
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

Every push to `main` builds `ghcr.io/collisionlab/osrs-planner:<commit>` and opens a PR in
`collisionlab/infra` pinning its digest (`scripts/pin-release`). Merging that PR deploys it to the
`app` host blue/green: the new release starts beside the old one and takes traffic only after it is
ready and passes smoke checks.

Tooling updates arrive as submodule bumps.

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

All imagery uses Explv's tile layout. Base plane-0 tiles are reused; missing
coverage and higher floors come from the sidecar's supplemental tiles. Runtime
checks schemas, release versions, content hashes and label compatibility before
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

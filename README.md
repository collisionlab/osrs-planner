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

## Releases

Every push to `main` builds `ghcr.io/collisionlab/osrs-planner:<commit>` and opens a PR in
`collisionlab/infra` pinning its digest (`scripts/pin-release`). Merging that PR deploys it to the
`app` host blue/green: the new release starts beside the old one and takes traffic only after it is
ready and passes smoke checks.

Tooling updates arrive as submodule bumps.

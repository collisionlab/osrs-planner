# Transport invariants

Open **Transport invariants** from the workbench home page, or visit
`http://workbench.localhost:5173/invariants` when Vite is running on its default port.
Run the planner service alongside Vite. The old `/candidates` address redirects here.
The selected finding is in `#finding=<id>`; the invariant and search filters are in the
query string. `j`/`k` move between findings.

Every finding is a row of the plugin data that breaks a rule. The service checks the
transport and location resources and the collision map bundled with its plugin revision
on each request (`GET /api/workbench/v1/invariants`, service path
`/workbench/v1/invariants`), so the list is always that release's data: fix rows in
the plugin, bump the pin, and the findings go. Nothing here suggests a correction or
changes transport data.

The page used to hold a pinned import of BestPath's suggestion lists. That was removed:
most of it was stale or noise, and static lists could not be kept up to date. New
candidates should come from a reproducible, filtered process instead (see below).

## The invariants

Seasonal transports are not checked, and their rows neither break nor satisfy a rule
for permanent ones. "Blocked" means the plugin's `CollisionMap.isBlocked`: no cardinal
movement into or out of the tile.

- **Destination** (`DestinationViolations`): a transport lands on a walkable tile, or on
  the exact origin (same tile and plane) of another transport. A nearby open tile or
  origin is not enough.
- **Entry** (`EntryViolations`): a transport starts on a walkable tile, or on a blocked
  tile that a chain of transports reaches from open ground or a teleport. The router
  lets a route walk onto a blocked transport origin from a neighbouring tile; this rule
  makes sure the data never relies on that. A blocked origin passes when a transport
  lands on it from a walkable origin or a teleport, or from another blocked origin that
  passes (chopping through jungle, stepping stones). Fairy rings are not checked yet;
  their rows still start chains.
- **Location** (`LocationViolations`): every bank, altar, anvil and apothecary in the
  plugin's `destinations/` files is a walkable tile in a walking area that transports
  reach from Lumbridge. Reachability is the plugin's own structural reachability
  (`RoutingStaticBuilder.walkingGraph`): natural walking components joined by every
  transport and teleport, ignoring requirements. A finding gives the size of the area
  the location is in. Instances and raids (Tutorial Island, Chambers of Xeric) are
  expected findings to decide in the ledger.

## Finding identity and the review ledger

A finding's id is the invariant, a hash of the file and the exact row, and a `-2`, `-3`
suffix for identical rows in file order, so unrelated line insertions do not change it.

Record decisions in `service/src/main/resources/invariants/reviews.json`, keyed by
finding id, in a normal repository change. Absent entries are `unreviewed`.

```json
{
  "location-0123456789abcdef01234567": {
    "status": "deferred",
    "explanation": "Raid instance: reached through the raid lobby, not a transport.",
    "reference": "Optional issue, commit, or evidence citation"
  }
}
```

Statuses are `accepted`, `rejected`, `needs_evidence` or `deferred`; an explanation is
required. The service rejects unknown ids, so remove an entry when its row is fixed.
**Copy review note** copies the finding as a Markdown template.

## Adding candidates

New transport candidates (for example ladders and stairs from the game cache) belong in
a reproducible pipeline in shortest-path-tooling that records its cache version and
keeps only high-signal rows: ones that join walking areas no current transport joins
nearby, or that reach an area these checks report as unreached. Its output can then be
checked against these invariants like any other change.

## Verification

```sh
gradle --no-daemon :service:test
npm test
npm run build
npm run e2e
```

Use `nix develop -c <command>` for the repository's Node, Gradle, JDK and Playwright
browser environment. The service tests check each rule on small fixtures and that the
destination findings agree with the plugin's own transport loader; the browser tests in
`e2e/workbench.spec.ts` use the mocked service and the real inset map.

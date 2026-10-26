# Transport candidates

Open **Transport candidates** from the workbench home page, or visit
`http://workbench.localhost:5173/candidates` when Vite is running on its default port.
Run the usual planner service alongside Vite. Production uses the workbench host at
`/candidates`. Candidate selection is in `#candidate=<id>`; category, status and
search filters are in the query string. Links survive reloads. Previous/Next and
`j`/`k` move between logical review units.

This queue contains unverified suggestions, not corrections. It does not change
canonical transport TSVs or the router. The existing PR review remains separate.

## Pinned import

The source is [rel-osrs/shortest-path at ca9ed24832c1c9948379d0684a99227b6724a42c](https://github.com/rel-osrs/shortest-path/tree/ca9ed24832c1c9948379d0684a99227b6724a42c/bestpath-candidates).
Read its README, also preserved in `service/src/main/resources/candidates/source/`.
The source repository's BSD-2-Clause license is retained there verbatim.
The contributor compared against upstream commit `0fb23cda`, matched automatically,
used cache 2735 for tiles, and did not re-check these rows in-game.

All twelve suggestion lists are imported, for **4,635 source rows**:

| Category | Rows |
|---|---:|
| Plane discrepancies | 2 |
| Non-floor endpoints | 32 |
| Coordinate offsets | 212 |
| Missing requirements | 457 |
| Requirements the format cannot hold | 39 |
| New transports with Wiki/cache citations | 1,587 |
| New teleports with citations | 57 |
| New network stops | 21 |
| Cache-derived ladders, stairs and crossings | 1,638 |
| New transports without tile sources | 357 |
| New transports in copied areas | 231 |
| New teleports in copied areas | 2 |

The running service splits **New transports with Wiki/cache citations** into
`sourced_transport` (both ends in existing routing components) and
`sourced_transport_outside_routing` (at least one end outside, including both ends).
Membership uses the bundled A* routing data: an exact search tile or an existing
transport site attached to at least one component. It does not snap proposed tiles
to nearby components. Both ends belonging to components does not mean they belong
to the same component, or that the transport is usable with a player's requirements.
This split is computed against the running plugin revision, without changing source
rows, candidate IDs or review decisions. The combined source count remains 1,587.
The category selector includes explanations for every category.

The nine definitions in `item-groups.tsv` are supporting evidence, not additional
candidate rows or changes to the requirement model. Other reported differences,
needs outside the format and unchecked tick estimates remain visible verbatim.

Regenerate offline from the checked-in source files:

```sh
npm run candidates:import
npm run candidates:check
npm run test:candidates-import
```

To download the sources again from the **same immutable revision** and regenerate:

```sh
npm run candidates:import -- --fetch
```

The fetch option is a developer action; builds and the running service never fetch
these files. It downloads the README, twelve candidate TSVs and item-group TSV,
validates all records and expected counts, and writes `candidates/catalogue.json`
and `candidates/item-groups.json`. Baseline column
headers in `candidates/headers.json` are copied from the twelve upstream transport
files at `0fb23cda`; they let the service interpret original rows even if a future
plugin changes column order. The shared Java `TransportDiff` parser interprets
both versions of each correction and each proposed row. The Node importer validates coordinate syntax without
implementing a second transport parser.

The documented ` | ` delimiter becomes a tab; bare `||` operators remain intact.
Empty and trailing cells, ordering and all proposed values are preserved. The
original encoded source record is retained too. Errors name the source file and
line and stop the import. Tests compare every row and a pinned catalogue SHA-256,
so unexpected content changes require investigation.

Correction IDs use the first 24 hex digits of SHA-256 over a JSON tuple containing
category, contributor filename, upstream filename, both exact TSV rows and the
three evidence fields. Contributor and upstream line numbers are references, not
identities. Identical occurrences receive deterministic `-2`, `-3` suffixes in
source order. New-proposal IDs hash category, contributor filename and the entire
raw source record, including evidence. The original 246 geometry records retain
their IDs and content fingerprint. The complete set has no duplicate IDs.

Corrections retain both exact rows. Unrepresentable requirement notes retain the
empty suggested row and expose a null structured suggestion; they do not invent
a replacement. New proposals have no original row, upstream filename or upstream
line number. Their own column header, transport cells and complete raw source
record are preserved. Those cells may contain unresolved quest names or contributor
item groups and must not be treated as directly applicable canonical TSV patches.

Pairs require reversed original endpoints **and** reversed proposed endpoints,
the same upstream file, category, contributor file and source citation, with a
unique match in both directions. Object IDs/actions can differ between directions.
New proposals may pair on exact reversed proposed endpoints with the same category,
file and citation; no original geometry is invented. Requirement notes and network
stops stay independent. Grouping uses indexed exact keys, without spatial clustering.
The complete set forms **2,872 units: 1,763 reverse pairs and 1,109 single rows**.
The geometry subset remains 167 units.
Rows are sorted by category (geometry first, then requirements, then new proposals), file and ID.
Navigation lists at most 80 units per page, with previous/next page controls;
only the selected unit's features are drawn.
Distance is displayed for inspection and is not a validity score.

## Current plugin data

`GET /api/workbench/v1/candidates` (through the frontend proxy; service path
`/workbench/v1/candidates`) serves the committed catalogue and review ledger,
parsed endpoint geometry, current row correspondences and plugin/tooling provenance.
Reconciliation reads the transport resources from the running service's plugin
classpath on each request. It is never baked into the imported JSON.

- `matches_current`: exactly one original raw row exists in its original file.
- `already_present`: no original row exists, but exactly one suggested raw row does.
- `diverged`: no exact match; one conservative possible correspondence remains.
- `missing`: no exact or conservative correspondence, including a removed file.
- `ambiguous`: duplicate exact rows or multiple possible correspondences.
- `proposed_new`: no exact endpoint correspondence found for a new proposal;
  this does not prove absence from current data.
- `possible_existing`: one exact endpoint correspondence for a new proposal;
  this does not prove equivalent identity or requirements.

Possible correspondences require the same nonempty action/display label and at
least one identical endpoint, or both identical finite endpoints for a metadata
edit. A teleport also needs its label because many teleports share destinations.
No matching uses proximity, object ID alone, or current line number. A candidate
whose two ends and label have all changed can be reported missing; manual
investigation is preferable to claiming an identity. Whitespace, requirements or
metadata changes are differences even if parsed coordinates still agree.
An exact original match takes precedence over a separately present suggestion.
New transport proposals are compared with raw rows from all the plugin's resource
types using exact endpoint pairs; teleports retain a null origin. Network stops
can identify boarding or landing rows at their exact tiles. Different labels or
requirements remain unresolved evidence, and multiple correspondences are ambiguous.

The map shows contributor original and proposed geometry, never an automatically
selected possible current row. Current correspondences and exact raw rows are
available in the detail panel. Original edges and tiles are dashed; suggestions
are solid. Origins are outlined and destinations filled. Unchanged endpoint
markers are drawn once per direction. All relevant planes and underground
regions use the existing inset layout; collision is loaded around these anchors.
An unchanged geometry comparison is drawn once in the shared-geometry tone.
Unrepresentable notes show only the original; new proposals show only the proposal.
Teleports never acquire an origin. Network stops show boarding and landing markers,
deduplicated when equal, without inventing network routes.

The field comparison shows requirement and metadata strings verbatim. Referenced
contributor item groups can be expanded to see their names, IDs and pinned source.
Neither these groups nor conditions in `Needs` are evaluated. Contributor tick
estimates are labelled unchecked, separate from the supplied duration field.
Unsourced tile proposals and copied-area proposals carry explicit evidence/instance
limitations even when a citation supports some other part of the row.

Collision flags describe open/closed edges, not authoritative floor truth.
The contributor's no-floor claim and cache version are separate from the displayed
tiles/collision release, manifest cache ID and dumper revision. An unavailable
collision square is reported unavailable. Special transition tiles may legitimately
have no ordinary walkable floor. Map plausibility does not establish in-game verification.

## Review ledger

Edit `service/src/main/resources/candidates/reviews.json` in a normal repository
change, keyed by candidate ID. Absent entries are implicitly `unreviewed`.
Each reverse direction keeps its own ID and decision.

```json
{
  "b80424b8f6d8922a2f44c04a": {
    "status": "needs_evidence",
    "explanation": "Check the cape arrival plane in-game.",
    "reference": "Optional issue, commit, or evidence citation"
  }
}
```

Statuses are `accepted`, `rejected`, `needs_evidence`, or `deferred`. A nonempty
explanation is required; reference is optional. Java tests reject unknown IDs,
invalid statuses, missing explanations and unknown fields. The service validates
the ledger too. Restart/rebuild the service to display a repository change.
`accepted` means verified and addressed separately; the ledger itself never
modifies transport data. The initial ledger is empty.

**Copy review note** copies ID, pinned source link, baseline file/line, original
and proposed coordinates, proposal and reconciliation into a Markdown template.
There are no browser writes, database, or Accept/Reject controls.

## Verification and limits

```sh
npm test
npm run build
gradle --no-daemon :service:test
npm run e2e
```

Use `nix develop -c <command>` for the repository's Node, Gradle, JDK and Playwright
browser environment. Import checks run as part of `npm test`. Browser tests extend
`e2e/workbench.spec.ts` using its existing mocked-service and actual inset-map setup;
their fixtures cover geometry, a diverged row, ledger decisions, requirement changes,
unrepresentable notes, new transport pairs, teleports, network stops, missing evidence
and catalogue pagination.

The queue checks starting-row correspondence and supports inspecting all suggested data.
Authoritative/in-game verification and applying corrections remain manual.
Requirement-model changes, automatic application, routing comparisons and benchmark
integration remain later work. Sensible next steps are gathering verification evidence
and recording explained decisions through repository review.

## Current destination violations

The category **destination violation** adds current plugin rows to the same review
queue. These are validation failures, not contributor proposals: the destination
must be walkable according to the plugin's `CollisionMap.isBlocked`, or must be the
exact origin of a transport on the same plane. Nearby open tiles, nearby origins,
and the older walk-away check do not exempt a row. Seasonal transports are excluded
from this validation: their destinations are not listed and their origins cannot
exempt a permanent transport's destination. Network landing rows and
teleports are checked too; rows without a destination are not landing failures.

The service checks the transport resources and collision bundled with its plugin
revision, including failures previously allowed by the walk-away check. It shows
the current row and source link, failure reason, highlighted destination and review
note, with no suggested replacement. The pinned contributor catalogue stays intact.
The map's published collision release can differ from the checked plugin data;
both provenances remain visible. IDs hash the source file and exact row, with
suffixes for duplicates, so unrelated line insertions do not change them. Ledger
entries use the same `reviews.json` format; remove obsolete entries when a fixed
or changed row disappears from the current violation list.

## Developer coordinate inspection

The candidate, PR review, transport explorer and inset investigation maps show
`x y plane` while hovering. Press **C** to copy the hovered tile, or right-click and
choose **Copy coordinates**. The menu holds the tile you right-clicked while you
move to its button; Escape or clicking outside closes it. Typing in a form keeps
working normally. Insets use their real world coordinates and plane after moving.
The main route planner does not enable coordinate inspection or its shortcut.

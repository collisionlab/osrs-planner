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

Only the three geometry lists are imported: 2 plane, 32 non-floor and 212 coordinate
offset rows. No requirements, discovery, network stops, or new teleports are imported.
Other differences mentioned in these geometry rows remain visible as evidence.

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
these files. It downloads the README and the three TSVs, validates all records and
the expected counts, and writes `candidates/catalogue.json`. Baseline column
headers in `candidates/headers.json` are copied from the seven upstream transport
files at `0fb23cda`; they let the service interpret original rows even if a future
plugin changes column order. The shared Java `TransportDiff` parser interprets
both versions of each row. The Node importer validates coordinate syntax without
implementing a second transport parser.

The documented ` | ` delimiter becomes a tab; bare `||` operators remain intact.
Empty and trailing cells, ordering and all proposed values are preserved. The
original encoded source record is retained too. Errors name the source file and
line and stop the import. Tests compare every row and a pinned catalogue SHA-256,
so unexpected content changes require investigation.

Candidate IDs use the first 24 hex digits of SHA-256 over a JSON tuple containing
category, contributor filename, upstream filename, both exact TSV rows and the
three evidence fields. Contributor and upstream line numbers are references, not
identities. Identical occurrences receive deterministic `-2`, `-3` suffixes in
source order. The pinned set has no duplicate IDs.

Pairs require reversed original endpoints **and** reversed proposed endpoints,
the same upstream file, category, contributor file and source citation, with a
unique match in both directions. Object IDs/actions can differ between directions.
The current set forms **167 units: 79 reverse pairs and 88 single rows**.
Rows are sorted by category (plane, non-floor, coordinate offset), file and ID.
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

Possible correspondences require the same nonempty action/display label and at
least one identical endpoint, or both identical finite endpoints for a metadata
edit. A teleport also needs its label because many teleports share destinations.
No matching uses proximity, object ID alone, or current line number. A candidate
whose two ends and label have all changed can be reported missing; manual
investigation is preferable to claiming an identity. Whitespace, requirements or
metadata changes are differences even if parsed coordinates still agree.
An exact original match takes precedence over a separately present suggestion.

The map shows contributor original and proposed geometry, never an automatically
selected possible current row. Current correspondences and exact raw rows are
available in the detail panel. Original edges and tiles are dashed; suggestions
are solid. Origins are outlined and destinations filled. Unchanged endpoint
markers are drawn once per direction. All relevant planes and underground
regions use the existing inset layout; collision is loaded around these anchors.

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
their six source candidates deliberately include a diverged row and a ledger decision.

This slice checks starting-row correspondence and supports geometry inspection.
Authoritative/in-game verification and applying corrections remain manual.
Requirement evaluation, routing comparisons, benchmark integration and transport
discovery remain later work. Sensible next steps are gathering verification evidence
and recording explained decisions through repository review.

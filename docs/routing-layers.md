# Routing partitions in Inset Investigation

The Routing partitions panel adds three independent controls to the shared OpenLayers map:
Routing components, Synthetic separators and Structurally unreachable. They work with any available
base style, including Blueprint. Each production component gets a faint tint (blocked tiles inside it
show as gaps), and borders between two components are thin crisp lines; the edge of the search graph
itself isn't outlined, since the base map and collision already show it. Selecting a retained search
tile highlights its production component with a solid outline and shows its tile count, bounds and
crossing adjacency. Focus component fits its actual location in the current inset placement. Gold
dashed centre-to-centre edges are internal synthetic walking crossings, including diagonals. Clicking
an edge outlines its two endpoint tiles and shows both production IDs and its recorded cost. These edges are never gameplay transports.

The magenta mask contains only structurally unreachable walkable terrain. Its size filter hides
whole small natural walking components for presentation; it changes no graph membership. Inspection
distinguishes excluded walkable terrain, reachable terrain absent from search, non-walkable terrain,
missing collision and a failed data fetch. Excluded tiles receive no invented production IDs.

`tiles.json.routingLayers` is an explicit compatible sidecar pin. The loader checks schema, artifact
version, tile release, production plugin revision and collision/transport/cut content hashes, then
checks every requested file checksum. Publish the sidecar before deploying its pin. Generation and
manifest-last upload live in osrs-tiles; see that repository's `docs/routing-layers.md` for commands
and the RTL1 binary format. No route-service or tooling changes are needed.

Rendering uses one viewport canvas layer in the existing composition. Fills come from cached
one-pixel-per-tile square bitmaps, scaled without smoothing so they stay tile-crisp; lines are stroked
in screen space each frame. Both sit under the collision/features, clipped to each displayed region's irregular mask and moved
with its existing placement. It clears obscured overlays before drawing upper contexts, so a ground
plane mask cannot leak through a pasted upper floor. Tile arrays are fetched once per source square,
not per placement, with 16 concurrent requests, a 256-square LRU and bounded bitmap caching.
Component boundaries and masks display at resolution <=16 map units/pixel (zoom >=7); separator
edges at <=8 (zoom >=8), and endpoint boxes only for the selected crossing. Zooming out
hides these details rather than drawing world-sized paths or millions of tile features. Toggling a
layer updates the existing composition without rebuilding the map.

Tests include original production bytes for Taverley Dungeon and a surface diagonal separator,
plus small fixtures testing sparse IDs, row ordering, square seams, filtering, invalid binary data
and version mismatches. The production snapshot in `e2e/fixtures/routing` retains original file hashes
and manifest. It intentionally contains only the visible test squares and global component metadata;
it is a fixture, not a publishable artifact. `dungeon.json` records sample tile coordinates and the
source revision. Taverley itself has no synthetic cut in this pinned production revision.

Run `npm test`, `npm run build`, and `nix develop -c npm run e2e -- e2e/routing-layers.spec.ts`.

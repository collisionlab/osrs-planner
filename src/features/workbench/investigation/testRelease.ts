import type { Region } from "../../../map/insets/geometry";
import { requiredAssets } from "../../../map/insets/testAssets";
import type { InsetAssets } from "../../../map/insets/assets";

/**
 * A small inset release for unit tests: a two-floor dungeon (`dun-a` with an entrance, `dun-b`
 * named but placed by nothing), an unnamed room transports reach (`dun-c`), and a lost region
 * nothing reaches or names (`lost`).
 */
const region = (id: string, plane: number, x: number, size = 20): Region => ({ id, plane, bounds: [x, 10000, x + size, 10000 + size],
  mask: [[x, 10000, size, size]], classification: "inset", tileCount: size * size, surfaceTiles: 0, touchesUnknown: false, examples: [] });

export const HASH = "0".repeat(64);
export const regions = [region("dun-a", 0, 100), region("dun-b", 1, 100, 10), region("dun-c", 0, 130, 10), region("lost", 0, 300)];
const entry = { areaKey: "dungeon", name: "Dungeon", status: "named", aliases: ["The Dungeon"], evidence: ["s-1", "c-1"], reason: "Its map label.", seed: [105, 10005, 0] };

export function release(): InsetAssets {
  const assets = requiredAssets(regions);
  assets.labels = {
    "dun-a": { name: "Dungeon", plane: 0, status: "named", areas: [entry] },
    "dun-b": { name: "Dungeon", plane: 1, status: "named", areas: [{ ...entry, seed: [105, 10005, 1] }] },
    "dun-c": { name: "Unidentified terrain at 130, 10000", plane: 0, status: "unresolved", areas: [] },
    lost: { name: "Unidentified terrain at 300, 10000", plane: 0, status: "unresolved", areas: [] },
  } as unknown as InsetAssets["labels"];
  assets.manifest.files["anchors.json"] = HASH;
  assets.evidence = { "s-1": { id: "s-1", kind: "mejrs", name: "Dungeon", point: [106, 10006, 0], source: "sheet", row: 3 } };
  return assets;
}

export const anchors = () => ({
  catalogueSha256: HASH,
  connections: {
    "c-1": { id: "c-1", action: "Climb-down Ladder 1", label: "", policy: "local", reason: "physical-action", duration: "1",
      source: { kind: "surface", membership: "mask", point: [3000, 3000, 0], regionId: "main" }, target: { kind: "inset", membership: "mask", point: [101, 10001, 0], regionId: "dun-a" },
      sources: [{ file: "transports.tsv", line: 12 }] },
    "c-2": { id: "c-2", action: "Squeeze-through Crack 2", label: "", policy: "local", reason: "physical-action", duration: "1",
      source: { kind: "inset", membership: "mask", point: [119, 10005, 0], regionId: "dun-a" }, target: { kind: "inset", membership: "mask", point: [131, 10005, 0], regionId: "dun-c" },
      sources: [{ file: "transports.tsv", line: 13 }] },
  },
  regions: {
    "dun-a": { status: "direct", defaultAnchor: 0, connectionIds: ["c-1", "c-2"], anchors: [{ curated: false, entrance: true, hops: 1, point: [3000, 3000, 0], path: [{ connectionId: "c-1", reversed: false }] }] },
    "dun-b": { status: "unresolved", defaultAnchor: null, connectionIds: [], anchors: [] },
    "dun-c": { status: "unresolved", defaultAnchor: null, connectionIds: ["c-2"], anchors: [] },
    lost: { status: "unresolved", defaultAnchor: null, connectionIds: [], anchors: [] },
  },
  reachableRegionIds: ["dun-a", "dun-c"],
  curatedIssues: [],
});

export const investigations = () => ({
  schemaVersion: 1, catalogueSha256: HASH, labelsSha256: HASH, anchorsSha256: HASH,
  plugin: { repository: "Skretzo/shortest-path", rev: "a".repeat(40) },
  areas: [
    { id: "region:lost", status: "provisional", areaKey: null, name: "Lost room", aliases: [], regionIds: ["lost"], relatedAreaIds: ["area:dungeon"], priority: 10,
      issues: [{ code: "large-unidentified", severity: "warning", message: "No name.", regionId: "lost" }],
      candidates: [{ id: "n-1", name: "Lost Cellar", regionId: "lost", evidence: ["s-9"], reason: "A label inside it." }] },
    { id: "area:dungeon", status: "named", areaKey: "dungeon", name: "Dungeon", aliases: [], regionIds: ["dun-a", "dun-b"], relatedAreaIds: [], priority: 5, issues: [], candidates: [] },
  ],
  evidence: { "s-9": { id: "s-9", kind: "wiki", name: "Lost Cellar", point: [310, 10010, 0], source: "wiki", url: "https://example.invalid/w" } },
});

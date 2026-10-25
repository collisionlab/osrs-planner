import { afterEach, describe, expect, it, vi } from "vitest";
import { componentTilePath, decodeRouting, localTile, RoutingData, squarePath, validateRoutingManifest, visibleNegative,
  type RoutingManifest, type RoutingPin } from "./routing";

/** One RTL1 square: production ids 17 and 934, one crossing reference (1400). */
function square() {
  const data = new DataView(new ArrayBuffer(16 + 2 * 4 + 4096 * 8 + 4));
  data.setUint32(0, 0x314c5452, true);
  data.setUint32(4, 2, true);
  data.setUint32(8, 1, true);
  data.setUint32(12, 4096, true);
  data.setInt32(16, 17, true);
  data.setInt32(20, 934, true);
  const tile = (x: number, y: number, ref: number, status: number, boundary: number, size: number) => {
    const i = 24 + (y * 64 + x) * 8;
    data.setUint16(i, ref, true);
    data.setUint8(i + 2, status);
    data.setUint8(i + 3, boundary);
    data.setUint32(i + 4, size, true);
  };
  tile(0, 0, 1, 1, 1, 300);
  tile(63, 0, 1, 1, 0, 300);
  tile(0, 63, 2, 1, 2 << 6, 4);
  tile(2, 5, 0, 2, 0, 3);
  tile(3, 5, 0, 3, 0, 250_000);
  data.setUint32(24 + 4096 * 8, 1400, true);
  return data;
}

const hash = "a".repeat(64);
const pin: RoutingPin = { version: "a".repeat(24), tileVersion: "2746-abc", pluginRevision: "f".repeat(40),
  collisionContentSha256: hash, transportSha256: hash, separatorSha256: hash };
const manifest = (): RoutingManifest => ({
  ...pin, schemaVersion: 3, plugin: { repository: "Skretzo/shortest-path", revision: pin.pluginRevision },
  componentCount: 2, effectiveCrossingCount: 1, searchTileCount: 3, structurallyUnreachableTileCount: 3,
  expanses: { minimumTiles: 100_000, tileCount: 250_000 }, componentPalette: ["f2dc1e", "4c55e8"],
  files: { "components.json": hash, "p0/50/50.bin": hash, "components/8/35/31.png": hash, "components/p1/3/1/0.png": hash },
});

afterEach(() => vi.unstubAllGlobals());

describe("production routing sidecar", () => {
  it("decodes south-to-north tiles, sparse production ids, absence, boundaries and crossing references", () => {
    const result = decodeRouting(square().buffer);
    expect(result.owners[0]).toBe(17);
    expect(result.owners[63 * 64]).toBe(934);
    expect(result.owners[5 * 64 + 2]).toBe(-1);
    // A component continuing over the square's east edge has no boundary there.
    expect(result.boundaries[63]).toBe(0);
    expect(result.boundaries[63 * 64]).toBe(128);
    expect(result.crossings).toEqual([1400]);
    expect(squarePath({ x: 3200, y: 3263, plane: 2 })).toBe("p2/50/50.bin");
    expect(localTile({ x: 3200, y: 3263 })).toBe(4032);
  });

  it("rejects truncation, invalid palette references and owned tiles that aren't reachable", () => {
    expect(() => decodeRouting(square().buffer.slice(1))).toThrow();
    const ref = square();
    ref.setUint16(24, 3, true);
    expect(() => decodeRouting(ref.buffer)).toThrow(/classification/);
    const owned = square();
    owned.setUint8(26, 2);
    expect(() => decodeRouting(owned.buffer)).toThrow(/classification/);
    const unknown = square();
    unknown.setUint8(26 + 5 * 64 * 8 + 2 * 8, 4);
    expect(() => decodeRouting(unknown.buffer)).toThrow(/classification/);
  });

  it("masks only unreachable terrain, filtered by its whole natural component's size, never an expanse", () => {
    const value = decodeRouting(square().buffer);
    expect(visibleNegative(value, 5 * 64 + 2, 3)).toBe(true);
    expect(visibleNegative(value, 5 * 64 + 2, 4)).toBe(false);
    expect(visibleNegative(value, 5 * 64 + 3, 0)).toBe(false);
    expect(visibleNegative(value, 1, 0)).toBe(false);
    expect(visibleNegative(value, 0, 0)).toBe(false);
  });

  it.each(["collisionContentSha256", "transportSha256", "separatorSha256", "tileVersion", "version"] as const)("rejects a mismatched %s", key => {
    expect(() => validateRoutingManifest({ ...manifest(), [key]: "different" }, pin, pin.tileVersion)).toThrow(/do not match/);
  });

  it("rejects another schema, plugin revision or an untrusted path", () => {
    expect(() => validateRoutingManifest(manifest(), pin, pin.tileVersion)).not.toThrow();
    expect(() => validateRoutingManifest({ ...manifest(), schemaVersion: 2 as 3 }, pin, pin.tileVersion)).toThrow(/do not match/);
    expect(() => validateRoutingManifest({ ...manifest(), files: { "components.json": hash, "components/9/1/1.png": hash } }, pin, pin.tileVersion)).toThrow(/file index/);
    expect(() => validateRoutingManifest({ ...manifest(), plugin: { repository: "Skretzo/shortest-path", revision: "other" } }, pin, pin.tileVersion)).toThrow();
    expect(() => validateRoutingManifest({ ...manifest(), files: { "components.json": hash, "../secret": hash } }, pin, pin.tileVersion)).toThrow();
  });

  it("tells unreachable, expanse, retained, non-walkable and missing collision apart", () => {
    const data = new RoutingData("https://example.test", manifest());
    data.put("p0/50/50.bin", decodeRouting(square().buffer));
    expect(data.inspect({ x: 3202, y: 3205, plane: 0 }).status).toContain("Structurally unreachable walking terrain");
    expect(data.inspect({ x: 3202, y: 3205, plane: 0 }).component).toBeUndefined();
    expect(data.inspect({ x: 3203, y: 3205, plane: 0 }).status).toContain("Open expanse (250,000 tiles");
    expect(data.inspect({ x: 3200, y: 3200, plane: 0 }).component).toBe(17);
    expect(data.inspect({ x: 3201, y: 3200, plane: 0 }).status).toBe("Non-walkable terrain");
    expect(data.inspect({ x: 3200, y: 3200, plane: 1 }).status).toBe("Missing collision data");
  });

  it("fetches a square once however often it is asked for, and keeps a failure as an error", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const data = new RoutingData("https://example.test", manifest());
    await Promise.all([data.loadSquare("p0/50/50.bin"), data.loadSquare("p0/50/50.bin")]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(data.inspect({ x: 3200, y: 3200, plane: 0 }).status).toContain("503");
    expect(data.inspect({ x: 3200, y: 3200, plane: 0 }).status).not.toContain("unreachable");
  });

  it("names component tiles in the styles' layout, and asks for each listed one once, checked", async () => {
    expect(componentTilePath(0, 8, 35, 31)).toBe("components/8/35/31.png");
    expect(componentTilePath(2, 3, 1, 0)).toBe("components/p2/3/1/0.png");
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetch);
    const data = new RoutingData("https://example.test", manifest());
    let told = 0;
    const done = new Promise<void>(resolve => data.subscribe(() => { told++; resolve(); }));
    expect(data.tile("components/8/35/31.png")).toBeUndefined();
    expect(data.tile("components/8/35/31.png")).toBeUndefined();
    // Not in the release, or only peeked at: never fetched.
    expect(data.tile("components/8/36/31.png")).toBeUndefined();
    expect(data.tile("components/p1/3/1/0.png", true)).toBeUndefined();
    await done;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(told).toBe(1);
    // These bytes don't match the manifest: an error, never a picture.
    expect(data.error).toContain("checksum mismatch");
    expect(data.tile("components/8/35/31.png")).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from "vitest";
import { parseTile, readState, sourceUrl, stationOf, toneOf, transportFeatures, viewOverlay, writeState, type TransportSummary, type TransportView } from "./transports";
import { provenance } from "./provenance";

const p = (x: number, y: number, plane = 0) => ({ x, y, plane });
const summary = (id: string, origin: ReturnType<typeof p> | null, destination: ReturnType<typeof p>, type = "TRANSPORT"): TransportSummary =>
  ({ id, type, file: "f.tsv", origin, destination, label: id, teleport: !origin, construction: origin ? "row" : "teleport", remappedFrom: null });
const box = { plane: 0, x1: 0, y1: 0, x2: 100, y2: 100 };

describe("transport explorer", () => {
  it("draws a transport's edge and tiles, a teleport's landing alone, and nothing of an end out of view", () => {
    expect(transportFeatures(summary("stairs", p(1, 1), p(3, 1))).map(f => f.kind)).toEqual(["edge", "point", "point"]);
    const teleport = transportFeatures(summary("tele", null, p(5, 5), "TELEPORTATION_ITEM"));
    expect(teleport).toEqual([{ kind: "point", key: "tele", point: p(5, 5), tone: "teleport", role: "destination", title: "tele\nanywhere → 5 5 0" }]);
    // A ship leaving the view: only its quay is drawn.
    expect(transportFeatures(summary("ship", p(50, 50), p(900, 900)), [box])).toMatchObject([
      { kind: "point", key: "ship", point: p(50, 50), tone: "object", role: "origin" }]);
    expect(transportFeatures(summary("ladder", p(50, 50), p(50, 50, 1)), [box]).map(f => f.kind)).toEqual(["point"]);
  });

  it("draws a hop between neighbouring tiles as one bar, unless it is the selection", () => {
    expect(transportFeatures(summary("door", p(1, 1), p(2, 1)))).toEqual([{ kind: "edge", key: "door", from: p(1, 1), to: p(2, 1), tone: "object", hop: true,
      title: "door\n1 1 0 → 2 1 0" }]);
    expect(transportFeatures(summary("door", p(1, 1), p(2, 1)), undefined, true).map(f => f.kind)).toEqual(["edge", "point", "point"]);
    // Diagonal neighbours, and tiles a floor apart, keep their tiles.
    expect(transportFeatures(summary("gap", p(1, 1), p(2, 2))).map(f => f.kind)).toEqual(["edge", "point", "point"]);
    expect(transportFeatures(summary("ladder", p(1, 1), p(2, 1, 1))).map(f => f.kind)).toEqual(["edge", "point", "point"]);
    // Half out of view: nothing, as a bar can't be half drawn.
    expect(transportFeatures(summary("door", p(100, 1), p(101, 1)), [box])).toEqual([]);
  });

  it("colours transports by kind", () => {
    expect(toneOf({ type: "AGILITY_SHORTCUT", teleport: false })).toBe("object");
    expect(toneOf({ type: "FAIRY_RING", teleport: false })).toBe("journey");
    expect(toneOf({ type: "TELEPORTATION_LEVER", teleport: false })).toBe("teleport");
    expect(toneOf({ type: "ANYTHING", teleport: true })).toBe("teleport");
  });

  it("anchors the selection, wherever it is, and draws it over the rest", () => {
    const view: TransportView = { total: 2, transports: [summary("a", p(1, 1), p(2, 2)), summary("b", p(3, 3), p(4, 4))] };
    // A door, but drawn whole while selected.
    const far = summary("far", p(3000, 3000), p(3001, 3000));
    const overlay = viewOverlay(view, far, undefined, [box]);
    expect(overlay.selected).toBe("far");
    expect(overlay.anchors.map(f => f.key)).toEqual(["far", "far", "far"]);
    expect(overlay.features.at(-1)!.key).toBe("far");
    // The selected one isn't drawn twice when it's in view too.
    expect(viewOverlay(view, view.transports[0], undefined, [box]).features.filter(f => f.key === "a")).toHaveLength(3);
  });

  it("draws a network as its tiles, once each, and a spoke from each station in view to its hub", () => {
    const ring = (id: string, from: ReturnType<typeof p>, to: ReturnType<typeof p>) => ({ ...summary(id, from, to, "FAIRY_RING"), construction: "paired" as const, network: "FAIRY_RING:0" });
    const view: TransportView = { total: 3, transports: [ring("ab", p(10, 10), p(51, 50)), ring("ac", p(10, 10), p(900, 900)), ring("ba", p(50, 50), p(11, 10))],
      networks: [{ id: "FAIRY_RING:0", type: "FAIRY_RING", name: "Fairy rings", hub: p(400, 400), stations: [
        { point: p(10, 10), name: "AIQ" }, { point: p(50, 50), name: "BKR" }, { point: p(900, 900), name: "CKS" }] }] };
    const overlay = viewOverlay(view, undefined, undefined, [box]);
    // No ring-to-ring edges; the far station's tile and spoke aren't in view, but the hub is drawn wherever it is.
    expect(overlay.features.filter(f => f.kind === "edge").map(f => f.kind === "edge" && [f.from, f.to, f.spoke, f.key])).toEqual([
      [p(10, 10), p(400, 400), true, "network:FAIRY_RING:0"], [p(50, 50), p(400, 400), true, "network:FAIRY_RING:0"]]);
    expect(overlay.features.filter(f => f.kind === "point").map(f => f.key)).toEqual(["station:10,10,0", "station:51,50,0", "station:50,50,0", "station:11,10,0"]);
    expect(overlay.features.filter(f => f.kind === "hub" && !f.station)).toEqual([{ kind: "hub", key: "network:FAIRY_RING:0", point: p(400, 400), tone: "journey", label: "Fairy rings",
      title: "Fairy rings: 3 stations" }]);
    // A station's tile says which station it is.
    expect(overlay.features.find(f => f.key === "station:10,10,0")?.title).toBe("Fairy rings: AIQ\nleave from 10 10 0");
    expect(stationOf("station:10,10,0")).toEqual(p(10, 10));
    expect(stationOf("0123456789ab")).toBeUndefined();
    // A selected network is highlighted; a selected ring is still drawn whole, with its real edge.
    expect(viewOverlay(view, undefined, undefined, [box], "FAIRY_RING:0").selected).toBe("network:FAIRY_RING:0");
    const picked = viewOverlay(view, view.transports[0], undefined, [box]);
    expect(picked.anchors.map(f => f.kind)).toEqual(["edge", "point", "point"]);
    // With hubs off: the stations' tiles alone.
    const bare = viewOverlay(view, undefined, undefined, [box], undefined, { networks: [] }).features;
    expect(bare.some(f => f.kind === "hub" || (f.kind === "edge" && f.spoke))).toBe(false);
    expect(bare.filter(f => f.kind === "point")).toHaveLength(4);
    // Zoomed out, with no view at all: every network given, its stations in view as nodes.
    const far = viewOverlay(undefined, undefined, undefined, undefined, undefined, { networks: view.networks!, inView: [box] }).features;
    expect(far.filter(f => f.kind === "hub").map(f => f.kind === "hub" && [f.key, !!f.station])).toEqual([
      ["station:10,10,0", true], ["station:50,50,0", true], ["network:FAIRY_RING:0", false]]);
    // Without networks (an older service), its transports are drawn as any other.
    expect(viewOverlay({ ...view, networks: undefined }, undefined, undefined, [box]).features.some(f => f.kind === "edge" && !f.spoke)).toBe(true);
  });

  it("draws nothing but the selection for a view too big to list", () => {
    const overlay = viewOverlay({ total: 150_000, transports: [] }, undefined);
    expect(overlay.features).toEqual([]);
    expect(overlay.anchors).toEqual([]);
  });

  it("keeps the selection, place, types and search in the URL", () => {
    const state = { selected: "0123456789ab", at: { point: p(3222, 3218, 1), zoom: 9 }, types: ["BOAT", "SHIP"], query: "fairy ring" };
    expect(writeState(state)).toBe("?t=0123456789ab&at=3222,3218,1&z=9&types=BOAT,SHIP&q=fairy+ring");
    expect(readState(writeState(state))).toEqual(state);
    expect(readState("?t=nope&at=1,2&z=40")).toEqual({});
    expect(readState("?types=")).toEqual({ types: [] });
    expect(writeState({ hubs: false })).toBe("?hubs=0");
    expect(readState("?hubs=0")).toEqual({ hubs: false });
    expect(readState("?hubs=1")).toEqual({});
  });

  it("reads typed tiles", () => {
    expect(parseTile("3222 3218 1")).toEqual(p(3222, 3218, 1));
    expect(parseTile("3222,3218")).toEqual(p(3222, 3218, 0));
    expect(parseTile("16671")).toBeUndefined();
  });

  it("links a source row at the plugin commit the data came from", () => {
    const source = { role: "row" as const, file: "src/main/resources/transports/boats.tsv", line: 12, section: "", fields: {} };
    expect(sourceUrl({ repository: "Skretzo/shortest-path", rev: "a".repeat(40) }, source))
      .toBe(`https://github.com/Skretzo/shortest-path/blob/${"a".repeat(40)}/src/main/resources/transports/boats.tsv#L12`);
    expect(sourceUrl({ repository: "Skretzo/shortest-path", rev: "unknown" }, source)).toContain("/blob/master/");
  });

  it("only calls collision consistent with transport data made from the same tooling commit", () => {
    const data = { plugin: { repository: "Skretzo/shortest-path", rev: "b".repeat(40) }, tooling: { repository: "o/shortest-path-tooling", rev: "c".repeat(40) } };
    const dumped = (rev: string) => ({ dumperSource: { repository: "o/shortest-path-tooling", rev }, cacheId: 2746 });
    expect(provenance(data, dumped("c".repeat(40)))[1].status).toBe("ok");
    const differs = provenance(data, dumped("d".repeat(40)))[1];
    expect(differs.status).toBe("differs");
    expect(differs.text).toContain("walls may not match");
    expect(provenance({ ...data, tooling: { ...data.tooling, rev: "unknown" } }, dumped("d".repeat(40)))[1].status).toBe("unknown");
    expect(provenance(data, undefined)[1].status).toBe("unknown");
  });
});

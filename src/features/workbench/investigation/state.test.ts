import { describe, expect, it } from "vitest";
import { readState, writeState } from "./state";

describe("investigation links", () => {
  it("round-trips everything a link holds", () => {
    const state = { area: "area:taverley-dungeon", region: "p1-2770-9792-d5ff518273", mode: "labelling" as const, item: "ev:s-1",
      plane: 1, at: { point: { x: 2791, y: 9819, plane: 1 }, zoom: 9 }, beside: true, release: "4708854a43b0", q: "tav" };
    const search = writeState(state);
    expect(search).toBe("?area=area:taverley-dungeon&region=p1-2770-9792-d5ff518273&mode=labelling&sel=ev:s-1&plane=1&at=2791,9819,1&z=9&place=entrance&v=4708854a43b0&q=tav");
    expect(readState(search)).toEqual(state);
  });

  it("defaults to topology and ignores what isn't an id, a plane or a place", () => {
    expect(readState("?area=<script>&plane=7&at=1,2&z=99&v=xyz&mode=other")).toEqual({ mode: "topology" });
    expect(readState("?at=3222,3218,0&z=99")).toEqual({ mode: "topology", at: { point: { x: 3222, y: 3218, plane: 0 }, zoom: 8 } });
    expect(writeState({ mode: "topology" })).toBe("");
  });
});

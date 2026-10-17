import { describe, expect, it } from "vitest";
import { mapToWorld, tileAddress, worldToMap } from "./projection";

describe("OSRS projection", () => {
  it("round-trips canonical tile coordinates", () => {
    const grandExchange = { x: 3165, y: 3487, plane: 0 };
    expect(mapToWorld(worldToMap(grandExchange), grandExchange.plane)).toEqual(grandExchange);
  });

  it("matches known production TMS tile addresses", () => {
    expect(tileAddress({ x: 3165, y: 3487, plane: 0 }, 11)).toEqual({ z: 11, x: 275, y: 283 });
    expect(tileAddress({ x: 2836, y: 10207, plane: 0 }, 11)).toEqual({ z: 11, x: 234, y: 1123 });
  });
});

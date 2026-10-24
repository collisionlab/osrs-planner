import { describe, expect, it } from "vitest";
import { bankFeatures, bankKey, bankOf, type Bank } from "./banks";

const p = (x: number, y: number, plane = 0) => ({ x, y, plane });
const banks: Bank[] = [
  { id: "varrock@3185,3436,0", name: "Varrock", tiles: [p(3185, 3436), p(3186, 3436)], needs: [] },
  { id: "aldarin@1399,2925,0", name: "Aldarin", tiles: [p(1399, 2925)], needs: [{ kind: "quest", name: "Children of the Sun" }] },
];

describe("banks", () => {
  it("draws each bank tile in view, outlined where it needs something", () => {
    expect(bankFeatures(banks, [{ plane: 0, x1: 3180, y1: 3430, x2: 3185, y2: 3440 }])).toEqual([
      { kind: "point", key: "bank:varrock@3185,3436,0", point: p(3185, 3436), tone: "bank", role: "destination", title: "Varrock bank" }]);
    expect(bankFeatures(banks, [{ plane: 0, x1: 1390, y1: 2920, x2: 1400, y2: 2930 }])[0].title).toBe("Aldarin bank\nneeds Children of the Sun");
    expect(bankFeatures(banks, [{ plane: 0, x1: 1390, y1: 2920, x2: 1400, y2: 2930 }]).map(f => f.kind === "point" && f.role)).toEqual(["origin"]);
    expect(bankFeatures(banks, [{ plane: 1, x1: 0, y1: 0, x2: 5000, y2: 5000 }])).toEqual([]);
  });

  it("finds a bank by its features' key", () => {
    expect(bankOf(banks, bankKey("aldarin@1399,2925,0"))?.name).toBe("Aldarin");
    expect(bankOf(banks, "network:FAIRY_RING:0")).toBeUndefined();
  });
});

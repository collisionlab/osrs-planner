import { describe, expect, it } from "vitest";
import { maskPath } from "./mask";
import type { Region } from "./geometry";

describe("inset mask path", () => {
  it("projects separate rectangles without filling the gap between them", () => {
    const region = { mask: [[10, 20, 2, 3], [15, 20, 1, 1]] } as Region;
    expect(maskPath(region, (x, y) => [(x - 10) * 2, (25 - y) * 2])).toBe(
      "M0,10L4,10L4,4L0,4ZM10,10L12,10L12,8L10,8Z",
    );
  });
});

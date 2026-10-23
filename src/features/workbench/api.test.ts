import { describe, expect, it } from "vitest";
import { parseSource, sourcePath } from "./api";
import { workbenchPath } from "./WorkbenchRoutes";

const A = "a".repeat(40), B = "b".repeat(40);

describe("workbench addresses", () => {
  it("mirrors GitHub's pull request and compare URLs", () => {
    expect(workbenchPath("https://github.com/Skretzo/shortest-path/pull/844/files")).toBe("/github/Skretzo/shortest-path/pull/844");
    expect(workbenchPath(`https://github.com/Skretzo/shortest-path/pull/844/files/${A}..${B}`))
      .toBe(`/github/Skretzo/shortest-path/pull/844/files/${A}..${B}`);
    expect(workbenchPath("github.com/mpickering/shortest-path/compare/master...add-prifddinas-transports"))
      .toBe("/github/mpickering/shortest-path/compare/master...add-prifddinas-transports");
    expect(workbenchPath("https://example.com/x")).toBeUndefined();
  });

  it("reads a pull request, a pinned push of one, or a compare range, and nothing else", () => {
    expect(parseSource("Skretzo", "shortest-path", "pull", "844")).toEqual({ kind: "pull", owner: "Skretzo", repo: "shortest-path", number: 844 });
    const pinned = parseSource("Skretzo", "shortest-path", "pull", "844", `${A}..${B}`);
    expect(pinned).toEqual({ kind: "pull", owner: "Skretzo", repo: "shortest-path", number: 844, range: { base: A, head: B } });
    expect(sourcePath(pinned!)).toBe(`/github/Skretzo/shortest-path/pull/844/files/${A}..${B}`);
    expect(parseSource("o", "r", "pull", "1", "master..x")).toBeUndefined();
    expect(parseSource("o", "r", "compare", "master...feature/x")).toEqual({ kind: "compare", owner: "o", repo: "r", base: "master", head: "feature/x" });
    expect(parseSource("o", "r", "compare", "master..x")).toBeUndefined();
    expect(parseSource("o", "r/../x", "pull", "1")).toBeUndefined();
  });
});

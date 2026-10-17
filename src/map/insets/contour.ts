import type { Region } from "./geometry";

/** Cancel shared tile edges, then join collinear runs: no internal rectangle seams. */
export function regionContour(region: Pick<Region, "mask">): number[][][] {
  const horizontal = new Map<number, Set<number>>();
  const vertical = new Map<number, Set<number>>();
  const toggle = (lines: Map<number, Set<number>>, fixed: number, start: number) => {
    const edges = lines.get(fixed) || new Set<number>();
    if (!edges.delete(start)) edges.add(start);
    lines.set(fixed, edges);
  };
  for (const [x, y, width, height] of region.mask) {
    for (let dx = 0; dx < width; dx++) { toggle(horizontal, y, x + dx); toggle(horizontal, y + height, x + dx); }
    for (let dy = 0; dy < height; dy++) { toggle(vertical, x, y + dy); toggle(vertical, x + width, y + dy); }
  }
  const result: number[][][] = [];
  const join = (lines: Map<number, Set<number>>, vertical: boolean) => {
    for (const [fixed, edges] of lines) {
      const starts = [...edges].sort((a, b) => a - b);
      for (let index = 0; index < starts.length; index++) {
        const start = starts[index];
        let end = start + 1;
        while (starts[index + 1] === end) { index++; end++; }
        result.push(vertical ? [[fixed, start], [fixed, end]] : [[start, fixed], [end, fixed]]);
      }
    }
  };
  join(horizontal, false);
  join(vertical, true);
  return result;
}

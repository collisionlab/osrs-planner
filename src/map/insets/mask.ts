import type { Region } from "./geometry";

/** Project tile edges with the same view transform as the map imagery. */
export function maskPath(region: Pick<Region, "mask">, project: (x: number, y: number) => number[]): string {
  return region.mask.map(([x, y, width, height]) => {
    const corners = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
    return corners.map(([cx, cy], index) => `${index ? "L" : "M"}${project(cx, cy).join(",")}`).join("") + "Z";
  }).join("");
}

export type MaskRect = [x: number, y: number, width: number, height: number];
export interface Region {
  id: string;
  plane: number;
  bounds: [minX: number, minY: number, maxX: number, maxY: number];
  tileCount: number;
  mask: MaskRect[];
  classification: "inset" | "main-world" | "mixed";
  surfaceTiles: number;
  touchesUnknown: boolean;
  examples: string[];
}

export function contains(region: Region, x: number, y: number, plane: number): boolean {
  return region.plane === plane && region.mask.some(([rx, ry, w, h]) => x >= rx && x < rx + w && y >= ry && y < ry + h);
}


import type { Region } from "./geometry";
import { maskPath } from "./mask";
import { TACTICAL_PIXELS_PER_TILE, nativeTileUrl } from "./tactical";
import type { InsetAssets } from "./assets";

const images = new Map<string, Promise<HTMLImageElement>>();

function image(url: string): Promise<HTMLImageElement> {
  let pending = images.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const timeout = setTimeout(() => { img.src = ""; reject(new Error(`Tile timed out: ${url}`)); }, 15000);
      img.onload = () => { clearTimeout(timeout); resolve(img); };
      img.onerror = () => { clearTimeout(timeout); reject(new Error(`Tile unavailable: ${url}`)); };
      img.src = url;
    });
    images.set(url, pending);
    void pending.catch(() => { if (images.get(url) === pending) images.delete(url); });
    while (images.size > 128) images.delete(images.keys().next().value!);
  }
  return pending;
}

/** Where an inset's terrain is cut from: a pinned tile pyramid and its style. */
export interface TerrainTiles { base: string; style: string }

export function regionTiles(region: Region, assets: InsetAssets, tilesBase: string, style = "tactical") {
  const [x1, y1, x2, y2] = region.bounds;
  const tiles: { url: string | undefined; x: number; y: number }[] = [];
  for (let x = Math.floor(x1 / 64); x < Math.ceil(x2 / 64); x++) {
    for (let y = Math.floor(y1 / 64); y < Math.ceil(y2 / 64); y++) {
      if (!region.mask.some(([rx, ry, width, height]) => x * 64 < rx + width && (x + 1) * 64 > rx
        && y * 64 < ry + height && (y + 1) * 64 > ry)) continue;
      tiles.push({ url: nativeTileUrl(assets, tilesBase, x, y, region.plane, style),
        x: (x * 64 - x1) * TACTICAL_PIXELS_PER_TILE, y: (y2 - (y + 1) * 64) * TACTICAL_PIXELS_PER_TILE });
    }
  }
  return tiles;
}

/** Assemble the masked native pixels once; the map view handles all subsequent pan and zoom. */
export function regionTerrain(region: Region, assets: InsetAssets, terrain: TerrainTiles, onUpdate: () => void) {
  const [x1, y1, x2, y2] = region.bounds;
  const scale = TACTICAL_PIXELS_PER_TILE;
  const canvas = document.createElement("canvas");
  if ((x2 - x1) * (y2 - y1) * scale * scale > 16_777_216) throw new Error("Inset exceeds terrain image limit");
  let disposed = false;
  canvas.width = (x2 - x1) * scale;
  canvas.height = (y2 - y1) * scale;
  const context = canvas.getContext("2d")!;
  const path = new Path2D(maskPath(region, (x, y) => [(x - x1) * scale, (y2 - y) * scale]));
  context.fillStyle = "#262b25";
  context.fill(path);
  const ready = Promise.all(regionTiles(region, assets, terrain.base, terrain.style).map(async tile => {
    if (!tile.url) return 1;
    try {
      const img = await image(tile.url);
      if (disposed) return 0;
      context.save();
      context.clip(path);
      context.imageSmoothingEnabled = false;
      context.drawImage(img, tile.x, tile.y);
      context.restore();
      onUpdate();
      return 0;
    } catch {
      return 1;
    }
  })).then(failures => failures.reduce<number>((sum, value) => sum + value, 0));
  return { canvas, ready, dispose() { disposed = true; canvas.width = canvas.height = 0; } };
}

import TileGrid from "ol/tilegrid/TileGrid";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import type { InsetAssets } from "./assets";
import { osrsProjection, osrsTileGrid, resolutions } from "./projection";

export const TACTICAL_NATIVE_ZOOM = 8;
export const TACTICAL_PIXELS_PER_TILE = 4;

export function nativeTileUrl(assets: InsetAssets, tilesBase: string, squareX: number, squareY: number, plane: number) {
  const square = (squareX << 8) | squareY;
  if (!assets.manifest.planes[plane]?.includes(square)) return undefined;
  const path = `8/${squareX - 15}/${squareY - 19}.png`;
  return assets.manifest.supplemental[plane].includes(square)
    ? `${assets.base}/planes/${plane}/${path}` : `${tilesBase}/${path}`;
}

export function surfaceLayer(url: string, attribution: string, maxNativeZoom = 8, plane = 0) {
  return new TileLayer({ source: new XYZ({
    projection: osrsProjection, tileGrid: new TileGrid({ extent: osrsTileGrid.getExtent()!, origin: osrsTileGrid.getOrigin(0), resolutions: resolutions.slice(0, maxNativeZoom + 1), tileSize: 256, minZoom: 3 }), wrapX: false, interpolate: false,
    attributions: attribution, maxZoom: maxNativeZoom,
    tileUrlFunction: ([z, x, y]) => url.replace("{plane}", String(plane)).replace("{z}", String(z))
      .replace("{x}", String(x)).replace("{y}", String(2 ** z - y - 1)),
  }) });
}

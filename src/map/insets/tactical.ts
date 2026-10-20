import TileGrid from "ol/tilegrid/TileGrid";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import { osrsProjection, osrsTileGrid, resolutions } from "./projection";

export const TACTICAL_NATIVE_ZOOM = 8;
export const TACTICAL_PIXELS_PER_TILE = 4;

/**
 * A native (zoom 8) tile of the pinned pyramid at `tilesBase` (a style's directory). Plane 0 is at its
 * root and planes 1–3 under p1/–p3/ (osrs-tiles docs/tiles.md). The inset build checks the pyramid has a
 * tile for every map square an inset area covers.
 */
export function nativeTileUrl(tilesBase: string, squareX: number, squareY: number, plane: number) {
  return `${tilesBase}/${plane ? `p${plane}/` : ""}8/${squareX - 15}/${squareY - 19}.png`;
}

export function surfaceLayer(url: string, attribution: string, maxNativeZoom = 8, plane = 0) {
  return new TileLayer({ source: new XYZ({
    projection: osrsProjection, tileGrid: new TileGrid({ extent: osrsTileGrid.getExtent()!, origin: osrsTileGrid.getOrigin(0), resolutions: resolutions.slice(0, maxNativeZoom + 1), tileSize: 256, minZoom: 3 }), wrapX: false, interpolate: false,
    attributions: attribution, maxZoom: maxNativeZoom,
    tileUrlFunction: ([z, x, y]) => url.replace("{plane}", String(plane)).replace("{z}", String(z))
      .replace("{x}", String(x)).replace("{y}", String(2 ** z - y - 1)),
  }) });
}

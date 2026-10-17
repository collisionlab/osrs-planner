import Projection from "ol/proj/Projection";
import TileGrid from "ol/tilegrid/TileGrid";
import type { Coordinate } from "ol/coordinate";
import type { WorldPoint } from "../../domain/contracts";

export const MAX_ZOOM = 11;
export const MIN_ZOOM = 4;
export const TILE_SIZE = 256;
export const WORLD_PIXEL_SIZE = TILE_SIZE * 2 ** MAX_ZOOM;

const MAP_HEIGHT = 364_544;
const GAME_TILE_PIXELS = 32;
const OFFSET_X = 960;
const OFFSET_Y = 6_208;

export const osrsProjection = new Projection({
  code: "OSRS:WORLD",
  units: "pixels",
  extent: [0, 0, WORLD_PIXEL_SIZE, WORLD_PIXEL_SIZE],
});

export const resolutions = Array.from({ length: MAX_ZOOM + 1 }, (_, zoom) => 2 ** (MAX_ZOOM - zoom));

export const osrsTileGrid = new TileGrid({
  extent: osrsProjection.getExtent(),
  minZoom: MIN_ZOOM,
  origin: [0, WORLD_PIXEL_SIZE],
  resolutions,
  tileSize: TILE_SIZE,
});

/** Matches the production Leaflet map's max-zoom pixel transform, but returns an OL coordinate. */
export function worldToMap(point: WorldPoint): Coordinate {
  const x = (point.x - OFFSET_X + 0.5) * GAME_TILE_PIXELS;
  const leafletY = MAP_HEIGHT - (point.y - OFFSET_Y + 0.5) * GAME_TILE_PIXELS;
  return [x, WORLD_PIXEL_SIZE - leafletY];
}

export function mapToWorld(coordinate: Coordinate, plane = 0): WorldPoint {
  const leafletY = WORLD_PIXEL_SIZE - coordinate[1];
  return {
    x: Math.floor(coordinate[0] / GAME_TILE_PIXELS + OFFSET_X),
    y: Math.floor((MAP_HEIGHT - leafletY) / GAME_TILE_PIXELS + OFFSET_Y),
    plane,
  };
}

export function tileAddress(point: WorldPoint, zoom: number) {
  const resolution = resolutions[zoom];
  const [x, y] = worldToMap(point);
  const xyzX = Math.floor(x / TILE_SIZE / resolution);
  const xyzY = Math.floor((WORLD_PIXEL_SIZE - y) / TILE_SIZE / resolution);
  return { z: zoom, x: xyzX, y: 2 ** zoom - xyzY - 1 };
}

export function tileUrl(tileCoordinate: number[]) {
  const [z, x, xyzY] = tileCoordinate;
  return `https://raw.githubusercontent.com/Explv/osrs_map_tiles/master/0/${z}/${x}/${2 ** z - xyzY - 1}.png`;
}

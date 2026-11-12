import type { WorldPoint } from "../../domain/contracts";
import { sha256, type InsetAssets } from "../../map/insets/assets";
import type { MapFeature } from "../../map/insets/features";
import type { Region } from "../../map/insets/geometry";
import type { WorldBox } from "../../map/insets/projection";
import type { UnreachedArea } from "../../map/insets/routing";

/**
 * The workbench's underground areas: each world map besides the main one (the inset release's
 * `world-maps.json`, from the cache's world map composites) with the walking areas in it that nothing
 * reaches (the routing release's `unreachable.json`, from the pinned plugin's own graph). An area is in
 * a map when its representative tile is among the real tiles the map draws.
 */

export interface WorldMap {
  name: string;
  /** The cache's own id for the map, used in the page's URL. */
  safeName: string;
  /** The real tiles it draws, as [plane, x, y, width, height]. */
  rects: [number, number, number, number, number][];
}

export interface UndergroundMap extends WorldMap {
  planes: number[];
  /** Its unreached areas, largest first. */
  areas: UnreachedArea[];
  /** Tiles in all of them, listed or not. */
  tiles: number;
}

/** Unreached areas smaller than this are counted, not listed: mostly a tile or two behind scenery. */
export const LISTED_TILES = 20;

export async function loadWorldMaps(assets: InsetAssets, signal?: AbortSignal): Promise<WorldMap[] | undefined> {
  const hash = assets.manifest.files["world-maps.json"];
  if (!hash) return undefined;
  const response = await fetch(`${assets.base}/world-maps.json`, { signal });
  if (!response.ok) throw new Error(`world-maps.json: ${response.status}`);
  const raw = await response.text();
  if (await sha256(raw) !== hash) throw new Error("world-maps.json does not match the inset release's manifest");
  return (JSON.parse(raw) as { maps: WorldMap[] }).maps;
}

const inside = ([plane, x, y, w, h]: WorldMap["rects"][number], point: [number, number, number]) =>
  point[2] === plane && point[0] >= x && point[0] < x + w && point[1] >= y && point[1] < y + h;

/** Each world map with the unreached areas whose representative tile it draws, in name order. */
export function undergroundMaps(maps: WorldMap[], areas: UnreachedArea[]): UndergroundMap[] {
  return maps.map(map => {
    const own = areas.filter(area => map.rects.some(rect => inside(rect, area.representative))).sort((a, b) => b.tiles - a.tiles);
    return { ...map, planes: [...new Set(map.rects.map(rect => rect[0]))].sort(), areas: own, tiles: own.reduce((sum, area) => sum + area.tiles, 0) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export const listed = (map: UndergroundMap) => map.areas.filter(area => area.tiles >= LISTED_TILES);

/** An area's id in the URL: its representative tile, unique within a routing release. */
export const areaId = (area: UnreachedArea) => area.representative.join("_");

export const areaBox = (area: UnreachedArea): WorldBox => ({
  plane: area.plane, x1: area.bounds[0], y1: area.bounds[1], x2: area.bounds[2] - 1, y2: area.bounds[3] - 1,
  reference: { x: area.representative[0], y: area.representative[1], plane: area.plane },
});

/** The inset regions with terrain among the map's real tiles on a plane, besides the main map's own. */
export function mapRegions(map: WorldMap, plane: number, regions: Region[]): Region[] {
  const rects = map.rects.filter(rect => rect[0] === plane);
  return regions.filter(region => region.plane === plane && region.classification !== "main-world"
    && region.mask.some(([x, y, w, h]) => rects.some(([, rx, ry, rw, rh]) => x < rx + rw && rx < x + w && y < ry + rh && ry < y + h)));
}

/** The map's listed areas on a plane, the selected one highlighted, as dashed boxes labelled by size. */
export function areaFeatures(map: UndergroundMap, plane: number): MapFeature[] {
  return listed(map).filter(area => area.plane === plane).map(area => ({
    kind: "region", key: areaId(area), plane, tone: "suspect", dashed: true,
    bounds: [area.bounds[0], area.bounds[1], area.bounds[2] - 1, area.bounds[3] - 1], label: `${area.tiles.toLocaleString()} tiles`,
  }));
}

export const representative = (area: UnreachedArea): WorldPoint => ({ x: area.representative[0], y: area.representative[1], plane: area.plane });

/** The GitHub issues reviewing a map's topology gaps (Skretzo/shortest-path#867), found by title. */
export const issuesUrl = (map: WorldMap) => `https://github.com/Skretzo/shortest-path/issues?q=${encodeURIComponent(`is:issue "Review underground topology gaps: ${map.name}"`)}`;

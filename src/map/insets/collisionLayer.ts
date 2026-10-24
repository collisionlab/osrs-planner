import Layer from "ol/layer/Layer";
import type OLMap from "ol/Map";
import type { Coordinate } from "ol/coordinate";
import type { WorldPoint } from "../../domain/contracts";
import type { CollisionMap } from "./collision";
import { visibleBoxes, worldToMap } from "./projection";
import type { RoutingPlacement } from "./routingLayer";

/**
 * The pathfinder's collision as a bold layer of its own, in the manner of the routing components:
 * blocked ground filled in red, so walkable ground is whatever the map shows through, and once single
 * tiles can be told apart, walls and doors between walkable tiles as heavy yellow lines and edges an
 * object closes as dashed white ones, each on a dark casing.
 */
export const COLLISION_COLOURS = { blocked: "rgba(235,38,58,.55)", wall: "#ffe23d", object: "#ffffff", casing: "rgba(14,16,14,.9)" };
const BLOCKED_RGBA = [235, 38, 58, 140];

/**
 * Map units a pixel above which nothing is drawn (a tile under a pixel: a view holds a few hundred
 * map squares there, each a 2 KB file), and above which edges aren't (a tile under 8 px).
 */
export const COLLISION_MAX_RESOLUTION = 32;
const MAX_RESOLUTION = COLLISION_MAX_RESOLUTION, EDGE_RESOLUTION = 4;
const CACHED_SQUARES = 600;

export interface CollisionOverlay {
  collision: CollisionMap;
  /** Draw only within `radius` tiles of these (a selection), rather than everywhere in view. */
  around?: { points: WorldPoint[]; radius: number };
}

/** `complete` once every neighbour it reads was there too, so later arrivals can't change it. */
interface SquareDrawing { blocked: HTMLCanvasElement; edges?: { walls: number[]; objects: number[] }; complete: boolean }

export function collisionLayer(map: OLMap, contexts: () => RoutingPlacement[]) {
  let overlay: CollisionOverlay | undefined;
  let unsubscribe: (() => void) | undefined;
  const canvas = document.createElement("canvas");
  canvas.dataset.collisionLayer = "true";
  canvas.style.position = "absolute";
  canvas.style.left = canvas.style.top = "0";
  canvas.style.pointerEvents = "none";
  const squares = new Map<string, SquareDrawing>();

  const pixel = (x: number, y: number, plane: number, offset: Coordinate) => {
    const point = worldToMap({ x, y, plane });
    return map.getPixelFromCoordinate([point[0] + offset[0], point[1] + offset[1]]);
  };

  /** A square's blocked tiles, one pixel a tile. */
  const drawing = (collision: CollisionMap, sx: number, sy: number, plane: number): SquareDrawing | undefined => {
    const name = `${plane}/${sx}/${sy}`, cached = squares.get(name);
    if (cached) return cached;
    if (collision.square(sx, sy, plane) === undefined) return undefined;
    // Its sides read its neighbours' tiles.
    const complete = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => collision.square(sx + dx, sy + dy, plane)).every(bytes => bytes !== undefined);
    const mask = collision.blockedTiles(sx, sy, plane)!;
    const blocked = document.createElement("canvas");
    blocked.width = blocked.height = 64;
    const ctx = blocked.getContext("2d")!;
    const image = ctx.createImageData(64, 64);
    const [r, g, b, a] = BLOCKED_RGBA;
    for (let i = 0; i < 4096; i++) if (mask[i]) {
      const p = ((63 - (i >> 6)) * 64 + (i & 63)) * 4;
      image.data[p] = r; image.data[p + 1] = g; image.data[p + 2] = b; image.data[p + 3] = a;
    }
    ctx.putImageData(image, 0, 0);
    const made: SquareDrawing = { blocked, complete };
    squares.set(name, made);
    while (squares.size > CACHED_SQUARES) squares.delete(squares.keys().next().value!);
    return made;
  };

  /** A square's closed edges between walkable tiles, in tile-edge coordinates, each from the tile south or west of it. */
  const edges = (collision: CollisionMap, drawn: SquareDrawing, sx: number, sy: number, plane: number) => {
    if (drawn.edges) return drawn.edges;
    const walls: number[] = [], objects: number[] = [];
    for (let i = 0; i < 4096; i++) {
      const x = sx * 64 + (i & 63), y = sy * 64 + (i >> 6);
      const tile = collision.tile({ x, y, plane });
      if (!tile || tile.blocked) continue;
      const north = !tile.north && collision.tile({ x, y: y + 1, plane })?.blocked === false;
      const east = !tile.east && collision.tile({ x: x + 1, y, plane })?.blocked === false;
      if (north) (tile.wallNorth ? walls : objects).push(x - .5, y + .5, x + .5, y + .5);
      if (east) (tile.wallEast ? walls : objects).push(x + .5, y - .5, x + .5, y + .5);
    }
    return drawn.edges = { walls, objects };
  };

  const stroke = (ctx: CanvasRenderingContext2D, lines: number[], plane: number, offset: Coordinate) => {
    ctx.beginPath();
    for (let i = 0; i < lines.length; i += 4) {
      const a = pixel(lines[i], lines[i + 1], plane, offset), b = pixel(lines[i + 2], lines[i + 3], plane, offset);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
  };

  const layer = new Layer({ zIndex: 59, render: frame => {
    const size = frame.size, ratio = frame.pixelRatio, resolution = frame.viewState.resolution;
    canvas.width = size[0] * ratio;
    canvas.height = size[1] * ratio;
    canvas.style.width = `${size[0]}px`;
    canvas.style.height = `${size[1]}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.imageSmoothingEnabled = false;
    if (!overlay || resolution > MAX_RESOLUTION) return canvas;
    const { collision, around } = overlay, tilePx = 32 / resolution;
    for (const { shape, offset } of contexts()) {
      const box = visibleBoxes(frame.extent!, [{ plane: shape.plane, bounds: shape.bounds, offset }])[0];
      if (!box) continue;
      const near = around?.points.filter(point => point.plane === shape.plane && point.x + around.radius >= box.x1 && point.x - around.radius <= box.x2
        && point.y + around.radius >= box.y1 && point.y - around.radius <= box.y2);
      if (near && !near.length) continue;
      ctx.save();
      // The placement's own terrain, and only near the selection when asked.
      ctx.beginPath();
      for (const [x, y, w, h] of shape.mask) {
        const a = pixel(x - .5, y + h - .5, shape.plane, offset), b = pixel(x + w - .5, y - .5, shape.plane, offset);
        ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      }
      ctx.clip();
      ctx.clearRect(0, 0, size[0], size[1]);
      if (near) {
        ctx.beginPath();
        for (const { x, y } of near) {
          const a = pixel(x - around!.radius - .5, y + around!.radius + .5, shape.plane, offset), b = pixel(x + around!.radius + .5, y - around!.radius - .5, shape.plane, offset);
          ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
        }
        ctx.clip();
      }
      const walls: number[][] = [], objects: number[][] = [];
      for (let sx = box.x1 >> 6; sx <= box.x2 >> 6; sx++) for (let sy = box.y1 >> 6; sy <= box.y2 >> 6; sy++) {
        if (!shape.mask.some(([x, y, w, h]) => x < (sx + 1) * 64 && x + w > sx * 64 && y < (sy + 1) * 64 && y + h > sy * 64)) continue;
        if (near && !near.some(({ x, y }) => x + around!.radius >= sx * 64 && x - around!.radius < (sx + 1) * 64 && y + around!.radius >= sy * 64 && y - around!.radius < (sy + 1) * 64)) continue;
        const square = drawing(collision, sx, sy, shape.plane);
        if (!square) continue;
        const a = pixel(sx * 64 - .5, (sy + 1) * 64 - .5, shape.plane, offset), b = pixel((sx + 1) * 64 - .5, sy * 64 - .5, shape.plane, offset);
        ctx.drawImage(square.blocked, a[0], a[1], b[0] - a[0], b[1] - a[1]);
        if (resolution <= EDGE_RESOLUTION) {
          const lines = edges(collision, square, sx, sy, shape.plane);
          walls.push(lines.walls); objects.push(lines.objects);
        }
      }
      if (resolution <= EDGE_RESOLUTION) {
        const width = Math.min(6, Math.max(2, tilePx * .18));
        ctx.lineCap = "square";
        ctx.strokeStyle = COLLISION_COLOURS.casing; ctx.lineWidth = width + 2.5;
        [...walls, ...objects].forEach(lines => stroke(ctx, lines, shape.plane, offset));
        ctx.strokeStyle = COLLISION_COLOURS.wall; ctx.lineWidth = width;
        walls.forEach(lines => stroke(ctx, lines, shape.plane, offset));
        ctx.lineCap = "butt"; ctx.setLineDash([Math.max(2, tilePx * .2), Math.max(2, tilePx * .15)]);
        ctx.strokeStyle = COLLISION_COLOURS.object; ctx.lineWidth = Math.max(1.5, width * .75);
        objects.forEach(lines => stroke(ctx, lines, shape.plane, offset));
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
    return canvas;
  } });
  map.addLayer(layer);

  return {
    update(next?: CollisionOverlay) {
      if (next?.collision !== overlay?.collision) {
        unsubscribe?.();
        // A square arriving changes its own drawing and its neighbours' edges.
        unsubscribe = next?.collision.subscribe(() => {
          for (const [name, drawn] of squares) if (!drawn.complete) squares.delete(name);
          layer.changed();
        });
        squares.clear();
      }
      overlay = next;
      layer.changed();
    },
    dispose() {
      unsubscribe?.();
      squares.clear();
      map.removeLayer(layer);
      layer.dispose();
    },
  };
}

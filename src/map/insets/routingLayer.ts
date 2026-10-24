import Layer from "ol/layer/Layer";
import type OLMap from "ol/Map";
import type { Coordinate } from "ol/coordinate";
import type { WorldPoint } from "../../domain/contracts";
import { contains, type Region } from "./geometry";
import { mapToWorld, visibleBoxes, worldToMap } from "./projection";
import { COMPONENT_ZOOMS, componentTilePath, squarePath, TILE_ORIGIN, visibleNegative, type RoutingCrossing, type RoutingOverlay,
  type RoutingSquare } from "./routing";

// Magenta: no terrain style uses it, so the mask never reads as dirt or lava.
const UNREACHABLE = "rgba(214,70,170,.5)";
const BORDER = "rgba(226,236,240,.85)";
const SEPARATOR = "#e8b765";
const SEPARATOR_SELECTED = "#fff3a6";

/** The view resolution at which the component pyramid's zoom 0 would be drawn at its own size. */
const PYRAMID_ZERO_RESOLUTION = 2 ** 11;
/** Map units per pixel above which nothing but the component colours is drawn, and above which separators aren't. */
const MAX_RESOLUTION = 16;
const SEPARATOR_RESOLUTION = 16;
const CACHED_BITMAPS = 64;

export interface RoutingPlacement { shape: Pick<Region, "plane" | "bounds" | "mask">; offset: Coordinate }

/**
 * The routing overlay: one viewport canvas in the shared composition, clipped to each placement's
 * terrain and moved with it. Square bitmaps are shared by every placement of the same square.
 */
export function routingLayer(map: OLMap, contexts: () => RoutingPlacement[]) {
  let overlay: RoutingOverlay | undefined;
  let unsubscribe: (() => void) | undefined;
  // Component colours on their own canvas, from the release's component tiles, blended in `color`
  // mode: the terrain keeps its lightness and detail and takes the component's hue, on dark styles as
  // on light. The mask, selection and lines go over them on another canvas, drawn as they are.
  const element = document.createElement("div");
  element.style.position = "absolute";
  element.style.inset = "0";
  element.style.pointerEvents = "none";
  const tints = document.createElement("canvas");
  tints.dataset.routingTints = "true";
  tints.style.mixBlendMode = "color";
  const canvas = document.createElement("canvas");
  canvas.dataset.routingLayer = "true";
  for (const c of [tints, canvas]) { c.style.position = "absolute"; c.style.left = c.style.top = "0"; element.append(c); }
  const bitmaps = new Map<RoutingSquare, HTMLCanvasElement>();

  const pixel = (x: number, y: number, plane: number, offset: Coordinate) => {
    const point = worldToMap({ x, y, plane });
    return map.getPixelFromCoordinate([point[0] + offset[0], point[1] + offset[1]]);
  };
  /** Tile fills only, one pixel per tile: scaled without smoothing they stay tile-crisp at every zoom. */
  const bitmap = (square: RoutingSquare) => {
    const cached = bitmaps.get(square);
    if (cached) return cached;
    const image = document.createElement("canvas");
    image.width = image.height = 64;
    const ctx = image.getContext("2d")!, options = overlay!.options;
    const fill = (colour: string, x: number, y: number) => { ctx.fillStyle = colour; ctx.fillRect(x, y, 1, 1); };
    for (let i = 0; i < 4096; i++) {
      const x = i & 63, y = 63 - (i >> 6);
      if (options.unreachable && visibleNegative(square, i, options.minimumSize)) fill(UNREACHABLE, x, y);
    }
    bitmaps.set(square, image);
    while (bitmaps.size > CACHED_BITMAPS) bitmaps.delete(bitmaps.keys().next().value!);
    return image;
  };

  /**
   * The component tiles over a placement's visible box, at the pyramid zoom nearest the view's
   * resolution without being coarser, each scaled to its map squares without smoothing.
   */
  const drawTints = (ctx: CanvasRenderingContext2D, box: { x1: number; y1: number; x2: number; y2: number }, plane: number, offset: Coordinate,
    resolution: number) => {
    const z = Math.max(COMPONENT_ZOOMS.min, Math.min(COMPONENT_ZOOMS.native, Math.ceil(Math.log2(PYRAMID_ZERO_RESOLUTION / resolution) - 1e-9)));
    const span = 2 ** (COMPONENT_ZOOMS.native - z);
    const column = (x: number) => Math.floor(((x >> 6) - TILE_ORIGIN.x) / span), row = (y: number) => Math.floor(((y >> 6) - TILE_ORIGIN.y) / span);
    for (let c = Math.max(0, column(box.x1)); c <= column(box.x2); c++) {
      for (let r = Math.max(0, row(box.y1)); r <= row(box.y2); r++) {
        const x0 = (TILE_ORIGIN.x + c * span) * 64, y0 = (TILE_ORIGIN.y + r * span) * 64, size = span * 64;
        const a = pixel(x0 - .5, y0 + size - .5, plane, offset), b = pixel(x0 + size - .5, y0 - .5, plane, offset);
        const path = componentTilePath(plane, z, c, r);
        if (!overlay!.data.manifest.files[path]) continue;
        const image = overlay!.data.tile(path);
        if (image) {
          ctx.drawImage(image, a[0], a[1], b[0] - a[0], b[1] - a[1]);
          continue;
        }
        // Until it arrives, the part of a coarser tile already here.
        for (let up = 1; z - up >= COMPONENT_ZOOMS.min; up++) {
          const k = 2 ** up, parent = overlay!.data.tile(componentTilePath(plane, z - up, Math.floor(c / k), Math.floor(r / k)), true);
          if (!parent) continue;
          const part = 256 / k, sx = (c % k) * part, sy = (k - 1 - (r % k)) * part;
          ctx.drawImage(parent, sx, sy, part, part, a[0], a[1], b[0] - a[0], b[1] - a[1]);
          break;
        }
      }
    }
  };

  /**
   * Tile-edge segments, in world tile-edge coordinates (tile centres are integers): borders between
   * two production components. Blocked tiles inside a component are already visible as gaps in its
   * tint, so the edge of the search graph isn't outlined, and a component picked by a click isn't
   * highlighted: its colour already shows it.
   */
  const segments = (square: RoutingSquare, sx: number, sy: number) => {
    const options = overlay!.options, borders: number[] = [];
    for (let i = 0; i < 4096; i++) {
      const flags = square.boundaries[i];
      if (!flags) continue;
      const x = sx * 64 + (i & 63), y = sy * 64 + (i >> 6);
      for (let side = 0; side < 4; side++) {
        const kind = (flags >> (side * 2)) & 3;
        const target = kind === 2 && options.components ? borders : undefined;
        if (!target) continue;
        // N, E, S, W edges of the tile's unit square.
        if (side === 0) target.push(x - .5, y + .5, x + .5, y + .5);
        else if (side === 1) target.push(x + .5, y - .5, x + .5, y + .5);
        else if (side === 2) target.push(x - .5, y - .5, x + .5, y - .5);
        else target.push(x - .5, y - .5, x - .5, y + .5);
      }
    }
    return { borders };
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

  /**
   * The pathfinder's synthetic crossings as barriers: both tiles of each crossing filled amber, and
   * for side-by-side tiles the edge between them striped black and amber like a road barrier, so a
   * cut reads as a wall across the ground. The inspected crossing is pale and outlined.
   */
  const drawSeparators = (ctx: CanvasRenderingContext2D, edges: Iterable<RoutingCrossing>, offset: Coordinate, resolution: number) => {
    const { selectedCrossing } = overlay!.options;
    const tilePx = 32 / resolution, list = [...edges];
    const tile = (x: number, y: number, plane: number) => {
      const a = pixel(x - .5, y + .5, plane, offset), b = pixel(x + .5, y - .5, plane, offset);
      return [a[0], a[1], b[0] - a[0], b[1] - a[1]] as const;
    };
    for (const edge of list) {
      const selected = edge.id === selectedCrossing?.id;
      ctx.fillStyle = selected ? "rgba(255,243,166,.75)" : "rgba(232,183,101,.6)";
      for (const end of [edge.from, edge.to]) ctx.fillRect(...tile(end[0], end[1], end[2]));
    }
    const width = Math.max(2, Math.min(7, tilePx * .3));
    for (const edge of list) {
      const [x1, y1, plane] = edge.from, [x2, y2] = edge.to;
      if (Math.abs(x1 - x2) + Math.abs(y1 - y2) !== 1) continue;
      // The shared edge: across the middle of the step, a tile long.
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, along = x1 === x2;
      const a = pixel(along ? mx - .5 : mx, along ? my : my - .5, plane, offset), b = pixel(along ? mx + .5 : mx, along ? my : my + .5, plane, offset);
      ctx.lineCap = "butt";
      ctx.setLineDash([]);
      ctx.strokeStyle = "#141914"; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      ctx.strokeStyle = edge.id === selectedCrossing?.id ? SEPARATOR_SELECTED : SEPARATOR;
      ctx.setLineDash([Math.max(2, tilePx * .2), Math.max(2, tilePx * .2)]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.setLineDash([]);
    if (selectedCrossing) {
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
      for (const end of [selectedCrossing.from, selectedCrossing.to]) ctx.strokeRect(...tile(end[0], end[1], end[2]));
    }
  };

  const layer = new Layer({ zIndex: 58, render: frame => {
    const size = frame.size, ratio = frame.pixelRatio, resolution = frame.viewState.resolution;
    const [ctx, tint] = [canvas, tints].map(c => {
      c.width = size[0] * ratio;
      c.height = size[1] * ratio;
      c.style.width = `${size[0]}px`;
      c.style.height = `${size[1]}px`;
      const context = c.getContext("2d")!;
      context.scale(ratio, ratio);
      context.imageSmoothingEnabled = false;
      return context;
    });
    const options = overlay?.options;
    if (!overlay || !options || !(options.components || options.separators || options.unreachable)) return element;
    // Zoomed out, only the component colours: the squares' details would be millions of tiles.
    const detailed = resolution <= MAX_RESOLUTION;
    if (!detailed && !options.components) return element;
    for (const { shape, offset } of contexts()) {
      const box = visibleBoxes(frame.extent!, [{ plane: shape.plane, bounds: shape.bounds, offset }])[0];
      if (!box) continue;
      // Clip to the placement's own terrain, and clear what an earlier placement drew under it.
      for (const context of [ctx, tint]) {
        context.save();
        context.beginPath();
        for (const [x, y, w, h] of shape.mask) {
          const a = pixel(x - .5, y + h - .5, shape.plane, offset), b = pixel(x + w - .5, y - .5, shape.plane, offset);
          context.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
        }
        context.clip();
        context.clearRect(0, 0, size[0], size[1]);
      }
      if (options.components) drawTints(tint, box, shape.plane, offset, resolution);
      if (!detailed) {
        ctx.restore();
        tint.restore();
        continue;
      }
      const edges = new Map<number, RoutingCrossing>(), borders: number[][] = [];
      for (let sx = box.x1 >> 6; sx <= box.x2 >> 6; sx++) {
        for (let sy = box.y1 >> 6; sy <= box.y2 >> 6; sy++) {
          // Skip squares outside irregular terrain before loading them.
          if (!shape.mask.some(([x, y, w, h]) => x < (sx + 1) * 64 && x + w > sx * 64 && y < (sy + 1) * 64 && y + h > sy * 64)) continue;
          const path = squarePath({ x: sx * 64, y: sy * 64, plane: shape.plane }), square = overlay.data.get(path);
          if (!square) {
            void overlay.data.loadSquare(path);
            continue;
          }
          const a = pixel(sx * 64 - .5, (sy + 1) * 64 - .5, shape.plane, offset), b = pixel((sx + 1) * 64 - .5, sy * 64 - .5, shape.plane, offset);
          ctx.drawImage(bitmap(square), a[0], a[1], b[0] - a[0], b[1] - a[1]);
          const lines = segments(square, sx, sy);
          borders.push(lines.borders);
          square.edges.forEach(edge => edges.set(edge.id, edge));
        }
      }
      ctx.lineCap = "square";
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1.5;
      borders.forEach(lines => stroke(ctx, lines, shape.plane, offset));
      if (options.separators && resolution <= SEPARATOR_RESOLUTION) drawSeparators(ctx, edges.values(), offset, resolution);
      ctx.restore();
      tint.restore();
    }
    return element;
  } });
  map.addLayer(layer);

  return {
    update(next?: RoutingOverlay) {
      if (next === overlay) return;
      if (next?.data !== overlay?.data) {
        unsubscribe?.();
        unsubscribe = next?.data.subscribe(() => layer.changed());
      }
      overlay = next;
      bitmaps.clear();
      layer.changed();
    },
    /** The separator under a click, on the plane and placement shown there, as drawn. */
    crossing(coordinate: Coordinate, point: WorldPoint) {
      if (!overlay?.options.separators || (map.getView().getResolution() ?? 100) > SEPARATOR_RESOLUTION) return undefined;
      // The topmost placement holding the clicked tile decides.
      const placement = [...contexts()].reverse().find(({ shape, offset }) => {
        const hit = mapToWorld([coordinate[0] - offset[0], coordinate[1] - offset[1]], shape.plane);
        return contains(shape as Region, hit.x, hit.y, hit.plane);
      });
      if (!placement) return undefined;
      const { shape, offset } = placement;
      const hit = mapToWorld([coordinate[0] - offset[0], coordinate[1] - offset[1]], shape.plane);
      if (point.plane !== hit.plane || point.x !== hit.x || point.y !== hit.y) return undefined;
      const target = map.getPixelFromCoordinate(coordinate), tolerance = Math.min(6, 10 / (map.getView().getResolution() ?? 1));
      // Adjacent squares too: an edge can straddle a square border.
      for (let sx = (hit.x - 1) >> 6; sx <= (hit.x + 1) >> 6; sx++) {
        for (let sy = (hit.y - 1) >> 6; sy <= (hit.y + 1) >> 6; sy++) {
          for (const edge of overlay.data.get(squarePath({ x: sx * 64, y: sy * 64, plane: hit.plane }))?.edges || []) {
            const a = pixel(edge.from[0], edge.from[1], hit.plane, offset), b = pixel(edge.to[0], edge.to[1], hit.plane, offset);
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const t = Math.max(0, Math.min(1, ((target[0] - a[0]) * dx + (target[1] - a[1]) * dy) / (dx * dx + dy * dy)));
            if (Math.hypot(target[0] - a[0] - t * dx, target[1] - a[1] - t * dy) <= tolerance) return edge;
          }
        }
      }
      return undefined;
    },
    dispose() {
      unsubscribe?.();
      bitmaps.clear();
      map.removeLayer(layer);
      layer.dispose();
    },
  };
}

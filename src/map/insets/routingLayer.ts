import Layer from "ol/layer/Layer";
import type OLMap from "ol/Map";
import type { Coordinate } from "ol/coordinate";
import type { WorldPoint } from "../../domain/contracts";
import { worldToMap, mapToWorld, visibleBoxes } from "./projection";
import type { Region } from "./geometry";
import { contains } from "./geometry";
import { visibleNegative, type RoutingOverlay, type RoutingSquare, type RoutingCrossing } from "./routing";

export interface RoutingPlacement { shape: Pick<Region, "plane" | "bounds" | "mask">; offset: Coordinate }
/** One viewport canvas in the shared OL composition; source-square bitmaps are reused by every placement. */
export function routingLayer(map: OLMap, contexts: () => RoutingPlacement[]) {
  let overlay: RoutingOverlay | undefined;
  let unsubscribe: (() => void) | undefined;
  const canvas = document.createElement("canvas");
  canvas.dataset.routingLayer = "true"; canvas.style.position = "absolute"; canvas.style.pointerEvents = "none";
  const bitmaps = new Map<RoutingSquare, HTMLCanvasElement>();
  const pixel = (x: number, y: number, plane: number, offset: Coordinate) => {
    const point = worldToMap({ x, y, plane }); return map.getPixelFromCoordinate([point[0] + offset[0], point[1] + offset[1]]);
  };
  const bitmap = (square: RoutingSquare) => {
    const cached = bitmaps.get(square); if (cached) return cached;
    const image = document.createElement("canvas"); image.width = image.height = 512;
    const ctx = image.getContext("2d")!, options = overlay!.options;
    const selected = new Set([options.selectedComponent, options.selectedCrossing?.fromComponent, options.selectedCrossing?.toComponent].filter((id): id is number => id !== undefined));
    for (let i = 0; i < 4096; i++) {
      const x = (i & 63) * 8, y = (63 - (i >> 6)) * 8;
      if (options.unreachable && visibleNegative(square, i, options.minimumSize)) { ctx.fillStyle = "rgba(205,104,72,.38)"; ctx.fillRect(x, y, 8, 8); }
      const strong = (options.components || (options.separators && !!options.selectedCrossing)) && square.owners[i] >= 0 && selected.has(square.owners[i]);
      if (strong) { ctx.fillStyle = "rgba(107,197,230,.30)"; ctx.fillRect(x, y, 8, 8); }
      if (!options.components && !strong) continue;
      for (let side = 0; side < 4; side++) {
        const kind = (square.boundaries[i] >> (side * 2)) & 3;
        if (!kind) continue;
        ctx.strokeStyle = strong ? "#8ce0f4" : kind === 1 ? "rgba(160,174,183,.55)" : "rgba(140,190,210,.65)";
        ctx.lineWidth = strong ? 1.8 : .8; ctx.beginPath();
        const ends = [[x,y,x+8,y],[x+8,y,x+8,y+8],[x,y+8,x+8,y+8],[x,y,x,y+8]][side];
        ctx.moveTo(ends[0], ends[1]); ctx.lineTo(ends[2], ends[3]); ctx.stroke();
      }
    }
    bitmaps.set(square, image);
    while (bitmaps.size > 64) bitmaps.delete(bitmaps.keys().next().value!);
    return image;
  };
  const layer = new Layer({ zIndex: 58, render: frame => {
    const size = frame.size, ratio = frame.pixelRatio;
    canvas.width = size[0] * ratio; canvas.height = size[1] * ratio;
    canvas.style.width = `${size[0]}px`; canvas.style.height = `${size[1]}px`;
    const ctx = canvas.getContext("2d")!; ctx.scale(ratio, ratio); ctx.imageSmoothingEnabled = false;
    if (!overlay || frame.viewState.resolution > 16 || !(overlay.options.components || overlay.options.separators || overlay.options.unreachable)) return canvas;
    for (const { shape, offset } of contexts()) {
      const boxes = visibleBoxes(frame.extent!, [{ plane: shape.plane, bounds: shape.bounds, offset }]);
      if (!boxes.length) continue;
      const box = boxes[0];
      ctx.save(); ctx.beginPath();
      for (const [x,y,w,h] of shape.mask) {
        const a = pixel(x-.5,y+h-.5,shape.plane,offset), b = pixel(x+w-.5,y-.5,shape.plane,offset);
        ctx.rect(a[0],a[1],b[0]-a[0],b[1]-a[1]);
      }
      ctx.clip(); ctx.clearRect(0,0,size[0],size[1]);
      const edges = new Map<number, RoutingCrossing>();
      for (let sx = box.x1 >> 6; sx <= box.x2 >> 6; sx++) for (let sy = box.y1 >> 6; sy <= box.y2 >> 6; sy++) {
        // Skip squares outside irregular terrain before loading them.
        if (!shape.mask.some(([x,y,w,h]) => x < (sx+1)*64 && x+w > sx*64 && y < (sy+1)*64 && y+h > sy*64)) continue;
        const path = `p${shape.plane}/${sx}/${sy}.bin`, square = overlay.data.get(path);
        if (!square) { void overlay.data.loadSquare(path); continue; }
        const a = pixel(sx*64-.5,(sy+1)*64-.5,shape.plane,offset), b = pixel((sx+1)*64-.5,sy*64-.5,shape.plane,offset);
        ctx.drawImage(bitmap(square),a[0],a[1],b[0]-a[0],b[1]-a[1]);
        square.edges.forEach(edge => edges.set(edge.id,edge));
      }
      if (overlay.options.separators && frame.viewState.resolution <= 8) for (const edge of edges.values()) {
        const selected = edge.id === overlay.options.selectedCrossing?.id || (overlay.options.selectedComponent !== undefined && [edge.fromComponent,edge.toComponent].includes(overlay.options.selectedComponent));
        const a = pixel(edge.from[0],edge.from[1],edge.from[2],offset), b = pixel(edge.to[0],edge.to[1],edge.to[2],offset);
        ctx.strokeStyle = selected ? "#fff3a6" : "#e8b765"; ctx.lineWidth = selected ? 3 : 2; ctx.setLineDash([3,3]);
        ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke(); ctx.setLineDash([]);
        if (frame.viewState.resolution <= 2 || selected) for (const endpoint of [a,b]) {
          const half = 16 / frame.viewState.resolution; ctx.strokeRect(endpoint[0]-half,endpoint[1]-half,half*2,half*2);
        }
      }
      ctx.restore();
    }
    return canvas;
  } });
  map.addLayer(layer);
  return {
    update(next?: RoutingOverlay) {
      if (next === overlay) return;
      if (next?.data !== overlay?.data) { unsubscribe?.(); unsubscribe = next?.data.subscribe(() => layer.changed()); }
      overlay = next; bitmaps.clear(); layer.changed();
    },
    /** Picks only the displayed plane and mask, using the same placement offset as the bitmap. */
    crossing(coordinate: Coordinate, point: WorldPoint) {
      if (!overlay?.options.separators || (map.getView().getResolution() ?? 100) > 8) return undefined;
      for (const { shape, offset } of [...contexts()].reverse()) {
        const hit = mapToWorld([coordinate[0]-offset[0],coordinate[1]-offset[1]],shape.plane);
        if (!contains({ ...shape } as Region,hit.x,hit.y,hit.plane)) continue;
        if (point.plane !== hit.plane || point.x !== hit.x || point.y !== hit.y) return undefined;
        const target = map.getPixelFromCoordinate(coordinate), scale = map.getView().getResolution() ?? 1;
        // Include adjacent squares: an edge can straddle the square border.
        for (let sx=(hit.x-1)>>6;sx<=(hit.x+1)>>6;sx++) for(let sy=(hit.y-1)>>6;sy<=(hit.y+1)>>6;sy++) {
          for (const edge of overlay.data.get(`p${hit.plane}/${sx}/${sy}.bin`)?.edges || []) {
            const a=pixel(edge.from[0],edge.from[1],hit.plane,offset),b=pixel(edge.to[0],edge.to[1],hit.plane,offset);
            const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((target[0]-a[0])*dx+(target[1]-a[1])*dy)/(dx*dx+dy*dy)));
            if(Math.hypot(target[0]-a[0]-t*dx,target[1]-a[1]-t*dy)<=Math.min(6,10/scale)) return edge;
          }
        }
        return undefined;
      }
      return undefined;
    },
    dispose() { unsubscribe?.(); bitmaps.clear(); map.removeLayer(layer); layer.dispose(); },
  };
}

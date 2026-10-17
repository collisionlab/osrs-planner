import ImageCanvas from "ol/ImageCanvas";
import ImageSource from "ol/source/Image";
import { osrsProjection } from "./projection";

/** Reuse the native bitmap at every view resolution; moving only changes its map extent. */
export class PastedTerrainSource extends ImageSource {
  private piece: ImageCanvas;

  constructor(private readonly canvas: HTMLCanvasElement, extent: number[]) {
    super({ projection: osrsProjection, interpolate: false });
    this.piece = this.imageAt(extent);
  }

  private imageAt(extent: number[]) {
    return new ImageCanvas(extent, (extent[2] - extent[0]) / this.canvas.width, 1, this.canvas);
  }

  moveTo(extent: number[]) {
    this.piece = this.imageAt(extent);
    this.changed();
  }

  override getImageInternal() {
    return this.piece;
  }
}

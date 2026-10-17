import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import type LineString from "ol/geom/LineString";

/** Index persistent geometry by owner, so a drag never rebuilds or reclassifies the route. */
export class RegionFeatures {
  private owned = new Map<string, Feature<Geometry>[]>();
  private links = new Map<string, { geometry: LineString; endpoint: number }[]>();

  add(region: string, feature: Feature<Geometry>) {
    const features = this.owned.get(region) || [];
    features.push(feature);
    this.owned.set(region, features);
  }

  addLink(from: string, to: string, geometry: LineString) {
    [from, to].forEach((region, endpoint) => {
      const links = this.links.get(region) || [];
      links.push({ geometry, endpoint });
      this.links.set(region, links);
    });
  }

  translate(region: string, dx: number, dy: number) {
    if (!dx && !dy) return;
    for (const feature of this.owned.get(region) || []) feature.getGeometry()!.translate(dx, dy);
    for (const { geometry, endpoint } of this.links.get(region) || []) {
      const points = geometry.getCoordinates();
      points[endpoint][0] += dx;
      points[endpoint][1] += dy;
      geometry.setCoordinates(points);
    }
  }
}

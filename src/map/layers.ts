import tiles from "../../tiles.json";
// Both layers share Explv's layout (TMS, zoom 8 = 4px per game tile), so a
// style is only a different URL. Tactical comes from tiles.collisionlab.world
// at the version pinned in tiles.json; it stops at zoom 8 and Leaflet scales
// it up beyond that.
export type MapStyle = "standard" | "tactical";

export interface MapLayer {
  label: string;
  url: string;
  maxNativeZoom?: number;
  attribution: string;
}

export const mapLayers: Partial<Record<MapStyle, MapLayer>> = {
  standard: {
    label: "Standard",
    url: "https://raw.githubusercontent.com/Explv/osrs_map_tiles/master/0/{z}/{x}/{y}.png",
    attribution: 'Map tiles: <a href="https://github.com/Explv/osrs_map_tiles">Explv</a> / Jagex',
  },
  ...(tiles.styles.includes("tactical") && {
    tactical: {
      label: "Tactical",
      url: `${tiles.base}/tactical/${tiles.version}/{z}/{x}/{y}.png`,
      maxNativeZoom: 8,
      attribution: 'Map tiles: <a href="https://github.com/collisionlab/osrs-tiles">collisionlab</a> / Jagex',
    },
  }),
};

const STYLE_KEY = "osrs-planner.map-style";

// Tactical when the pinned tiles have it; Standard is the fallback.
export const defaultStyle: MapStyle = mapLayers.tactical ? "tactical" : "standard";

export function savedStyle(): MapStyle {
  try {
    const saved = localStorage.getItem(STYLE_KEY);
    if (saved && saved in mapLayers) return saved as MapStyle;
  } catch {
    // Storage can be unavailable (private windows, blocked site data).
  }
  return defaultStyle;
}

export function saveStyle(style: MapStyle) {
  try {
    localStorage.setItem(STYLE_KEY, style);
  } catch {
    // Not remembered; the choice still applies to this page.
  }
}


export interface InsetPin { version: string; tileVersion: string }
export const insetPin = tiles.insets as InsetPin | null;

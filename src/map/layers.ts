import tiles from "../../tiles.json";
// Every layer shares Explv's layout (TMS, zoom 8 = 4px per game tile), so a
// style is only a different URL. Tactical and Blueprint come from
// tiles.collisionlab.world at the version pinned in tiles.json, each only when
// that version has it; they stop at zoom 8 and the map scales them up beyond.
export type MapStyle = "standard" | "tactical" | "blueprint";

export interface MapLayer {
  label: string;
  url: string;
  maxNativeZoom?: number;
  attribution: string;
}

const PINNED_STYLES: { style: MapStyle; label: string }[] = [
  { style: "tactical", label: "Tactical" },
  { style: "blueprint", label: "Blueprint" },
];

/** The selectable layers for a tiles pin: Standard always, each pinned style when the pin has it. */
export function pinnedLayers(pin: { base: string; version: string; styles: string[] }) {
  const layers: Partial<Record<MapStyle, MapLayer>> = {
    standard: {
      label: "Standard",
      url: "https://raw.githubusercontent.com/Explv/osrs_map_tiles/master/0/{z}/{x}/{y}.png",
      attribution: 'Map tiles: <a href="https://github.com/Explv/osrs_map_tiles">Explv</a> / Jagex',
    },
  };
  for (const { style, label } of PINNED_STYLES) {
    if (!pin.styles.includes(style)) continue;
    layers[style] = {
      label,
      url: `${pin.base}/${style}/${pin.version}/{z}/{x}/{y}.png`,
      maxNativeZoom: 8,
      attribution: 'Map tiles: <a href="https://github.com/collisionlab/osrs-tiles">collisionlab</a> / Jagex',
    };
  }
  return layers;
}

export const mapLayers = pinnedLayers(tiles);

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

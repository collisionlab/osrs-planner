export type RouteLineKind = "walk" | "transport" | "teleport";

/** Production appearance shared by the Leaflet and OpenLayers maps. */
export function routeLineAppearance(kind: RouteLineKind, selected = false) {
  return {
    color: kind === "walk" ? selected ? "#fff2b0" : "#ffae47" : kind === "teleport" ? "#d7a6ff" : "#77e2d4",
    weight: kind === "walk" ? selected ? 7 : 4 : selected ? 6 : 3,
    opacity: 1,
    lineCap: "square" as const,
    lineJoin: "miter" as const,
    dashArray: kind === "walk" ? undefined : "6 8",
  };
}

export const routeMarkers = {
  start: { label: "A", className: "route-marker start", size: 32 },
  destination: { label: "B", className: "route-marker destination", size: 32 },
  bank: { label: "◇", className: "bank-marker", size: 24 },
} as const;

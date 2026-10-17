import Ajv from "ajv";
import type { Catalogue } from "./preview";

export interface InsetManifest {
  schemaVersion: 1;
  version: string;
  layout: "explv-tms-v1";
  tileVersion: string;
  cacheIdx255Sha256: string;
  files: Record<"regions.json" | "labels.json", string>;
  planes: number[][];
  supplemental: number[][];
}
export interface InsetAssets {
  catalogue: Catalogue;
  labels: Record<string, { name: string; plane: number }>;
  manifest: InsetManifest;
  base: string;
}
const integer = { type: "integer" };
const tuple = (length: number) => ({ type: "array", items: integer, minItems: length, maxItems: length });
const validateCatalogue = new Ajv().compile({
  type: "object", required: ["schemaVersion", "surfaceRects", "regions"], properties: {
    schemaVersion: { const: 1 }, surfaceRects: { type: "array", minItems: 1, items: tuple(5) },
    regions: { type: "array", minItems: 1, items: {
      type: "object", required: ["id", "plane", "bounds", "mask", "classification"], properties: {
        id: { type: "string", minLength: 1 }, plane: { type: "integer", minimum: 0, maximum: 3 },
        bounds: tuple(4), mask: { type: "array", minItems: 1, items: tuple(4) },
        classification: { enum: ["inset", "main-world", "mixed"] },
      },
    } },
  },
});
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const squares = { type: "array", minItems: 4, maxItems: 4, items: {
  type: "array", uniqueItems: true, items: { type: "integer", minimum: 0, maximum: 65535 },
} };
const validateManifest = new Ajv().compile({
  type: "object", required: ["schemaVersion", "version", "layout", "tileVersion", "cacheIdx255Sha256", "files", "planes", "supplemental"],
  properties: {
    schemaVersion: { const: 1 }, version: { type: "string", minLength: 1 }, layout: { const: "explv-tms-v1" }, tileVersion: { type: "string", minLength: 1 },
    cacheIdx255Sha256: hash, planes: squares, supplemental: squares,
    files: { type: "object", required: ["regions.json", "labels.json"], properties: { "regions.json": hash, "labels.json": hash } },
  },
});

export function checkCatalogue(value: unknown): Catalogue {
  if (!validateCatalogue(value)) throw new Error("Invalid inset terrain catalogue");
  const catalogue = value as Catalogue;
  const ids = new Set<string>();
  for (const region of catalogue.regions) {
    const [x1, y1, x2, y2] = region.bounds;
    if (ids.has(region.id) || x1 < 0 || y1 < 0 || x2 > 16384 || y2 > 16384 || x1 >= x2 || y1 >= y2
      || region.mask.some(([x, y, w, h]) => w <= 0 || h <= 0 || x < x1 || y < y1 || x + w > x2 || y + h > y2)) {
      throw new Error("Invalid inset geometry");
    }
    ids.add(region.id);
  }
  if (catalogue.surfaceRects.some(([p, x, y, w, h]) => p < 0 || p > 3 || x < 0 || y < 0
    || w <= 0 || h <= 0 || x + w > 16384 || y + h > 16384)) throw new Error("Invalid surface geometry");
  return catalogue;
}
export async function sha256(raw: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
export async function loadInsetAssets(base: string, tileVersion: string, signal: AbortSignal): Promise<InsetAssets> {
  const get = async (file: string) => {
    const response = await fetch(`${base}/${file}`, { signal });
    if (!response.ok) throw new Error(`Inset assets unavailable (${response.status})`);
    return response.text();
  };
  const manifest: unknown = JSON.parse(await get("manifest.json"));
  if (!validateManifest(manifest) || (manifest as InsetManifest).tileVersion !== tileVersion
    || (manifest as InsetManifest).version !== base.split("/").at(-1)) {
    throw new Error("Inset assets do not match the pinned tiles");
  }
  const checked = manifest as InsetManifest;
  const [regionsRaw, labelsRaw] = await Promise.all([get("regions.json"), get("labels.json")]);
  if (await sha256(regionsRaw) !== checked.files["regions.json"] || await sha256(labelsRaw) !== checked.files["labels.json"]) {
    throw new Error("Inset asset hash mismatch");
  }
  const catalogue = checkCatalogue(JSON.parse(regionsRaw));
  const naming = JSON.parse(labelsRaw);
  if (naming.schemaVersion !== 1 || naming.catalogueSha256 !== checked.files["regions.json"]
    || !naming.regions || typeof naming.regions !== "object") throw new Error("Invalid inset names");
  for (const region of catalogue.regions.filter(r => r.classification === "inset")) {
    const label = naming.regions[region.id];
    if (!label || typeof label.name !== "string" || !label.name.trim() || label.plane !== region.plane) {
      throw new Error("Invalid inset name");
    }
  }
  return { catalogue, labels: naming.regions, manifest: checked, base };
}

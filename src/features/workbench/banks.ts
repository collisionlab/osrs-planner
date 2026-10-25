import type { WorldPoint } from "../../domain/contracts";
import type { MapFeature } from "../../map/insets/features";
import type { WorldBox } from "../../map/insets/projection";
import type { Revision } from "./transports";

/**
 * The plugin's banks, from the planner service (`shortestpath.workbench.BankCatalog`): a bank's
 * booth, chest or deposit tiles, and what using it needs. There are about a hundred, so they come
 * all at once.
 */
export interface BankNeed { kind: "skill" | "quest" | "var"; name: string }
export interface Bank { id: string; name: string; tiles: WorldPoint[]; needs: BankNeed[] }
export interface Banks { plugin: Revision; banks: Bank[] }

export async function loadBanks(signal?: AbortSignal): Promise<Banks> {
  const response = await fetch("/api/workbench/v1/banks", { signal });
  if (!response.ok) {
    const message = await response.json().then(body => body?.error, () => undefined);
    throw new Error(message || `The bank service answered ${response.status}.`);
  }
  return response.json();
}

export const bankKey = (id: string) => `bank:${id}`;
export const bankOf = (banks: Bank[] | undefined, key: string) => key.startsWith("bank:") ? banks?.find(bank => bankKey(bank.id) === key) : undefined;

const inBox = (point: WorldPoint, box: WorldBox) => point.plane === box.plane && point.x >= box.x1 && point.x <= box.x2 && point.y >= box.y1 && point.y <= box.y2;

/** Each bank tile in view, filled where anyone can bank, outlined where it needs something first. */
export function bankFeatures(banks: Bank[], inView: WorldBox[]): MapFeature[] {
  return banks.flatMap(bank => bank.tiles.filter(tile => inView.some(box => inBox(tile, box))).map(point =>
    ({ kind: "point", key: bankKey(bank.id), point, tone: "bank", role: bank.needs.length ? "origin" : "destination",
      title: `${bank.name || "Bank"} bank${bank.needs.length ? `\nneeds ${bank.needs.map(need => need.name).join(", ")}` : ""}` }) as MapFeature));
}

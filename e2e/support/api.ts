import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Page, Request } from "@playwright/test";
import type { RoutePlan, WorldPoint } from "../../src/domain/contracts";

/**
 * The route API, answered in the browser from recorded fixtures (scripts/record-e2e-fixtures.mjs),
 * so the tests need no route service. A route the fixtures don't have is answered with a straight
 * walk, which is enough for tests about the map rather than about routing.
 */
const fixtures = path.resolve(import.meta.dirname, "../fixtures");
const json = (name: string) => JSON.parse(readFileSync(path.join(fixtures, name), "utf8"));

const presets: { id: string; name: string; account: { name: string } }[] = json("presets.json");
const catalog = json("catalog.json");
const planeLinks = json("plane-links.json");
const items: { key: string; name: string }[] = json("items.json");
const recorded: { scenario: { id: string; account: string; from: number[]; to: number[] }; plan: RoutePlan }[] =
  readdirSync(path.join(fixtures, "routes")).map(file => json(`routes/${file}`));

export interface RouteCall { body: { account: { name: string; levels: Record<string, number> }; settings: Record<string, unknown>;
  start: { coordinate: WorldPoint }; destination: { coordinate: WorldPoint } }; trigger?: string; scenario?: string }

const same = (point: WorldPoint, [x, y, plane]: number[]) => point.x === x && point.y === y && point.plane === plane;

/** A walk along the straight line between two tiles on one plane, or a single step between planes. */
function straightWalk(start: WorldPoint, end: WorldPoint): RoutePlan["segments"] {
  if (start.plane !== end.plane) {
    return [{ kind: "transport", transportId: "e2e", name: "Climb", from: start, to: end, costTicks: 2, requirements: [] }];
  }
  const steps = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y), 1);
  const path = Array.from({ length: steps + 1 }, (_, i) => ({
    x: Math.round(start.x + (end.x - start.x) * i / steps), y: Math.round(start.y + (end.y - start.y) * i / steps), plane: start.plane,
  }));
  return [{ kind: "walk", costTicks: steps, path }];
}

/** Serves the API to `page` and returns the route requests it receives, in order. */
export async function mockApi(page: Page): Promise<RouteCall[]> {
  const calls: RouteCall[] = [];
  await page.route("**/api/v1/**", async route => {
    const request: Request = route.request();
    const url = new URL(request.url());
    const endpoint = url.pathname.replace(/^\/api\/v1\//, "");
    if (endpoint === "presets") return route.fulfill({ json: presets });
    if (endpoint === "catalog") return route.fulfill({ json: catalog });
    if (endpoint === "plane-links") return route.fulfill({ json: planeLinks });
    if (endpoint === "items") {
      const ids = url.searchParams.get("ids")?.split(",");
      const query = url.searchParams.get("q")?.toLowerCase() || "";
      return route.fulfill({ json: ids ? items.filter(item => ids.includes(item.key))
        : query.length < 2 ? [] : items.filter(item => item.name.toLowerCase().includes(query)).slice(0, 30) });
    }
    if (endpoint === "route") {
      const body = request.postDataJSON() as RouteCall["body"];
      const match = Object.keys(body.settings).length === 0 ? recorded.find(({ scenario }) =>
        presets.find(preset => preset.id === scenario.account)?.account.name === body.account.name
        && same(body.start.coordinate, scenario.from) && same(body.destination.coordinate, scenario.to)) : undefined;
      calls.push({ body, trigger: request.headers()["x-route-trigger"], scenario: match?.scenario.id });
      const segments = match ? match.plan.segments : straightWalk(body.start.coordinate, body.destination.coordinate);
      const plan: RoutePlan = match ? { ...match.plan, start: body.start, destination: body.destination } : {
        apiVersion: "v1", reachable: true, costTicks: segments.reduce((sum, segment) => sum + segment.costTicks, 0),
        start: body.start, destination: body.destination, segments,
        metadata: { worldDataVersion: "e2e", accountSchemaVersion: 1, routingEngineVersion: "astar-v1" },
      } as RoutePlan;
      return route.fulfill({ json: plan });
    }
    return route.fulfill({ status: 404, json: { error: `no e2e fixture for ${endpoint}` } });
  });
  return calls;
}

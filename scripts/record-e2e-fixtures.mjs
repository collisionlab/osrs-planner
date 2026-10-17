// Records the route API responses the Playwright tests (e2e/) replay, from a route service running
// locally (nix develop -c gradle :service:run). Rerun after an API or routing change:
//   node scripts/record-e2e-fixtures.mjs [http://127.0.0.1:8080]
// Routes are recorded for each scenario in e2e/fixtures/scenarios.json; the tests answer any other
// route with a straight walk.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "e2e/fixtures");
const api = process.argv[2] || "http://127.0.0.1:8080";

async function get(endpoint) {
  const response = await fetch(`${api}${endpoint}`);
  if (!response.ok) throw new Error(`${endpoint}: ${response.status}`);
  return response.json();
}
const write = (name, value) => writeFile(path.join(fixtures, name), JSON.stringify(value) + "\n");

const presets = await get("/v1/presets");
await write("presets.json", presets);
await write("catalog.json", await get("/v1/catalog"));
await write("plane-links.json", await get("/v1/plane-links"));
// Every item the service names: the tests answer searches and lookups from this.
const names = await readFile(path.join(root, "service/build/generated/route-item-names/route-item-names.tsv"), "utf8");
await write("items.json", names.trim().split("\n").map(line => {
  const [key, name] = line.split("\t");
  return { key, name };
}));

const point = ([x, y, plane]) => ({ x, y, plane });
for (const scenario of JSON.parse(await readFile(path.join(fixtures, "scenarios.json"), "utf8"))) {
  const account = presets.find(preset => preset.id === scenario.account).account;
  const request = { account, settings: {}, start: { name: "from", coordinate: point(scenario.from) },
    destination: { name: "to", coordinate: point(scenario.to) } };
  const response = await fetch(`${api}/v1/route`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request) });
  if (!response.ok) throw new Error(`${scenario.id}: ${response.status} ${await response.text()}`);
  await write(`routes/${scenario.id}.json`, { scenario, plan: await response.json() });
  console.log(`recorded ${scenario.id}`);
}

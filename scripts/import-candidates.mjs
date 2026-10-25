import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = path.resolve(fileURLToPath(new URL("../service/src/main/resources/candidates/", import.meta.url)));
export const files = [
  ["plane", "1g plane differs.tsv", 2],
  ["non_floor", "1i start or landing not on a floor tile.tsv", 32],
  ["coordinate_offset", "1f start or end 3 or more tiles off.tsv", 212],
  ["missing_requirements", "1a missing requirements.tsv", 457],
  ["unrepresentable_requirements", "1e requirements the format cannot hold.tsv", 39],
  ["sourced_transport", "3b new transports - Wiki or cache source.tsv", 1587, "addition"],
  ["sourced_teleport", "3b new transports - Wiki or cache source - teleports.tsv", 57, "addition"],
  ["network_stop", "3b new transports - Wiki or cache source - network stops.tsv", 21, "network_stop"],
  ["cache_transport", "3c new ladders and stairs - from the game cache.tsv", 1638, "addition"],
  ["unsourced_transport", "3d new transports - tiles not sourced.tsv", 357, "addition"],
  ["copied_area", "3e new transports - in copies of other areas.tsv", 231, "addition"],
  ["copied_area_teleport", "3e new transports - in copies of other areas - teleports.tsv", 2, "addition"],
];
export const sourceCommit = "ca9ed24832c1c9948379d0684a99227b6724a42c";
const columns = ["Their file", "Their line", "Current row", "Suggested row", "What changes", "Also differs", "Source"];

/** Decode only the documented delimiter. Bare || inside requirement cells is not a delimiter. */
export const decodeRow = value => value.split(" | ").join("\t");

const provenance = (sourceFile, sourceLine) => ({ sourceFile, sourceLine,
  sourceRepository: "rel-osrs/shortest-path", sourceCommit, upstreamCommit: "0fb23cda" });

function stableId(identity, seen) {
  const hash = createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24);
  const occurrence = (seen.get(hash) ?? 0) + 1; seen.set(hash, occurrence);
  return hash + (occurrence > 1 ? "-" + occurrence : "");
}

function validateCoordinates(names, values, fail, version) {
  for (const name of ["Origin", "Destination", "Board at", "Land at"]) {
    const column = names.indexOf(name);
    if (column < 0 || !values[column]) continue;
    if (!/^\d+ \d+ [0-3]$/.test(values[column])) fail(version + ": malformed " + name + " coordinate: " + values[column]);
  }
  if (!names.some((name, n) => ["Origin", "Destination", "Board at", "Land at"].includes(name) && values[n])) fail(version + ": no endpoints");
}

export function importFile(text, category, sourceFile, headers) {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.shift() !== columns.join("\t")) throw new Error(sourceFile + ": expected seven documented column headers");
  const seen = new Map();
  return lines.map((line, index) => {
    const fail = message => { throw new Error(sourceFile + ":" + (index + 2) + ": " + message); };
    const cells = line.split("\t");
    if (cells.length !== 7) fail("expected 7 columns, got " + cells.length);
    const [file, referenceLine, originalEncoded, suggestedEncoded, whatChanges, alsoDiffers, source] = cells;
    if (!headers[file]) fail("unknown upstream file " + file);
    if (!/^[1-9]\d*$/.test(referenceLine)) fail("Their line must be a positive integer");
    if (!whatChanges.trim() || !source.trim()) fail("What changes and Source must be explicit (use none recorded for missing evidence)");
    const originalRaw = decodeRow(originalEncoded), suggestedRaw = decodeRow(suggestedEncoded);
    // Coordinates are parsed by TransportDiff in Java. Validate their shape here using the pinned
    // baseline header, without introducing another transport parser or altering any proposed value.
    const names = headers[file].replace(/^#\s?/, "").split("\t");
    for (const [version, raw] of [["Current row", originalRaw], ["Suggested row", suggestedRaw]]) {
      if (version === "Suggested row" && category === "unrepresentable_requirements" && raw === "") continue;
      const values = raw.split("\t");
      if (values.length > names.length) fail(version + ": too many transport columns");
      validateCoordinates(names, values, fail, version);
    }
    const id = stableId([category, sourceFile, file, originalRaw, suggestedRaw, whatChanges, alsoDiffers, source], seen);
    return { id, category, file, originalLine: Number(referenceLine),
      originalRaw, suggestedRaw, whatChanges, alsoDiffers, source, sourceFile, sourceLine: index + 2,
      sourceRepository: "rel-osrs/shortest-path", sourceCommit, upstreamCommit: "0fb23cda" };
  });
}

const evidenceColumns = ["Needs (not in their format)", "Ticks (ours, not checked)", "Source"];
const normalColumns = ["Origin", "Destination", "menuOption menuTarget objectID", "Skills", "Items", "Quests", "Varbits", "VarPlayers", "Duration", "Display info"];
const teleportColumns = ["Destination", "menuOption menuTarget objectID", "Skills", "Items", "Quests", "Duration", "Display info", "Wilderness level", "Varbits", "VarPlayers"];
const networkColumns = ["Network", "Board at", "Land at", "menuOption menuTarget objectID", "Skills", "Items", "Quests", "Varbits", "VarPlayers", "Duration", "Display info"];

/** New proposals have their own column order and no invented upstream file or original row. */
export function importAdditions(text, category, sourceFile, kind) {
  const lines = text.split(/\r?\n/); if (lines.at(-1) === "") lines.pop();
  const names = lines.shift().split("\t");
  const transportColumns = kind === "network_stop" ? networkColumns : category.endsWith("teleport") ? teleportColumns : normalColumns;
  if (names.join("\t") !== [...transportColumns, ...evidenceColumns].join("\t")) throw new Error(sourceFile + ": unexpected proposal columns");
  const seen = new Map();
  return lines.map((sourceRaw, index) => {
    const fail = message => { throw new Error(sourceFile + ":" + (index + 2) + ": " + message); };
    const cells = sourceRaw.split("\t");
    if (cells.length !== names.length) fail("expected " + names.length + " columns, got " + cells.length);
    validateCoordinates(names, cells, fail, "Proposal");
    const source = cells.at(-1);
    if (!source.trim()) fail("Source must be explicit (use none recorded for missing evidence)");
    const fields = Object.fromEntries(names.map((name, n) => [name, cells[n]]));
    if (kind === "network_stop" && !fields.Network.trim()) fail("Network must be named");
    return { id: stableId([category, sourceFile, sourceRaw], seen), kind, category, file: null, originalLine: null,
      originalRaw: null, suggestedRaw: cells.slice(0, transportColumns.length).join("\t"),
      proposalHeader: transportColumns.join("\t"), sourceHeader: names.join("\t"), sourceRaw,
      whatChanges: kind === "network_stop" ? "Proposed new network stop" : "Proposed new transport",
      alsoDiffers: "", source, needs: fields[evidenceColumns[0]], uncheckedTicks: fields[evidenceColumns[1]],
      network: fields.Network ?? null, ...provenance(sourceFile, index + 2) };
  });
}

export function itemGroups() {
  const lines = readFileSync(path.join(root, "source", "item-groups.tsv"), "utf8").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.shift() !== "Group\tItem ids\tItem names") throw new Error("item-groups.tsv: unexpected headers");
  const seen = new Set();
  return lines.map((raw, index) => {
    const cells = raw.split("\t"), [name, itemIds, itemNames] = cells;
    if (cells.length !== 3 || !name || seen.has(name) || !/^\d+(,\d+)*$/.test(itemIds) || !itemNames) {
      throw new Error("item-groups.tsv:" + (index + 2) + ": malformed or duplicate item group");
    }
    seen.add(name);
    return { name, itemIds, itemNames, raw, ...provenance("item-groups.tsv", index + 2) };
  });
}

export function catalogue() {
  const headers = JSON.parse(readFileSync(path.join(root, "headers.json"), "utf8"));
  return files.flatMap(([category, file, count, kind]) => {
    const text = readFileSync(path.join(root, "source", file), "utf8");
    const candidates = kind ? importAdditions(text, category, file, kind) : importFile(text, category, file, headers);
    if (candidates.length !== count) throw new Error(file + ": expected " + count + " rows, got " + candidates.length);
    return candidates;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Optional regeneration from the immutable revision. Normal imports and builds are offline.
  if (process.argv.includes("--fetch")) {
    const downloads = await Promise.all(["README.md", "item-groups.tsv", ...files.map(([, file]) => file)].map(async file => {
      const url = "https://raw.githubusercontent.com/rel-osrs/shortest-path/" + sourceCommit + "/bestpath-candidates/" + encodeURIComponent(file);
      const response = await fetch(url);
      if (!response.ok) throw new Error(file + ": download answered " + response.status);
      return [file, Buffer.from(await response.arrayBuffer())];
    }));
    for (const [file, body] of downloads) writeFileSync(path.join(root, "source", file), body);
  }
  for (const [file, data] of [["catalogue.json", catalogue()], ["item-groups.json", itemGroups()]]) {
    const json = JSON.stringify(data, null, 2) + "\n", output = path.join(root, file);
    if (process.argv.includes("--check")) {
      if (readFileSync(output, "utf8") !== json) throw new Error(file + " is stale: run node scripts/import-candidates.mjs");
    } else writeFileSync(output, json);
  }
}

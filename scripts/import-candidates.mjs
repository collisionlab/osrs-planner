import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = path.resolve(fileURLToPath(new URL("../service/src/main/resources/candidates/", import.meta.url)));
export const files = [
  ["plane", "1g plane differs.tsv", 2],
  ["non_floor", "1i start or landing not on a floor tile.tsv", 32],
  ["coordinate_offset", "1f start or end 3 or more tiles off.tsv", 212],
];
export const sourceCommit = "ca9ed24832c1c9948379d0684a99227b6724a42c";
const columns = ["Their file", "Their line", "Current row", "Suggested row", "What changes", "Also differs", "Source"];

/** Decode only the documented delimiter. Bare || inside requirement cells is not a delimiter. */
export const decodeRow = value => value.split(" | ").join("\t");

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
      const values = raw.split("\t");
      if (values.length > names.length) fail(version + ": too many transport columns");
      for (const name of ["Origin", "Destination"]) {
        const column = names.indexOf(name);
        if (column < 0 || !values[column]) continue; // network stops may have one empty end
        if (!/^\d+ \d+ [0-3]$/.test(values[column])) fail(version + ": malformed " + name + " coordinate: " + values[column]);
      }
      if (!names.some((name, n) => ["Origin", "Destination"].includes(name) && values[n])) fail(version + ": no endpoints");
    }
    const identity = JSON.stringify([category, sourceFile, file, originalRaw, suggestedRaw, whatChanges, alsoDiffers, source]);
    const hash = createHash("sha256").update(identity).digest("hex").slice(0, 24);
    const occurrence = (seen.get(hash) ?? 0) + 1; seen.set(hash, occurrence);
    return { id: hash + (occurrence > 1 ? "-" + occurrence : ""), category, file, originalLine: Number(referenceLine),
      originalRaw, suggestedRaw, whatChanges, alsoDiffers, source, sourceFile, sourceLine: index + 2,
      sourceRepository: "rel-osrs/shortest-path", sourceCommit, upstreamCommit: "0fb23cda" };
  });
}

export function catalogue() {
  const headers = JSON.parse(readFileSync(path.join(root, "headers.json"), "utf8"));
  return files.flatMap(([category, file, count]) => {
    const candidates = importFile(readFileSync(path.join(root, "source", file), "utf8"), category, file, headers);
    if (candidates.length !== count) throw new Error(file + ": expected " + count + " rows, got " + candidates.length);
    return candidates;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Optional regeneration from the immutable revision. Normal imports and builds are offline.
  if (process.argv.includes("--fetch")) {
    const downloads = await Promise.all(["README.md", ...files.map(([, file]) => file)].map(async file => {
      const url = "https://raw.githubusercontent.com/rel-osrs/shortest-path/" + sourceCommit + "/bestpath-candidates/" + encodeURIComponent(file);
      const response = await fetch(url);
      if (!response.ok) throw new Error(file + ": download answered " + response.status);
      return [file, Buffer.from(await response.arrayBuffer())];
    }));
    for (const [file, body] of downloads) writeFileSync(path.join(root, "source", file), body);
  }
  const json = JSON.stringify(catalogue(), null, 2) + "\n";
  const output = path.join(root, "catalogue.json");
  if (process.argv.includes("--check")) {
    if (readFileSync(output, "utf8") !== json) throw new Error("Candidate catalogue is stale: run node scripts/import-candidates.mjs");
  } else writeFileSync(output, json);
}

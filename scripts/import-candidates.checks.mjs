import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { catalogue, decodeRow, files, importFile, root } from "./import-candidates.mjs";

const headers = JSON.parse(readFileSync(path.join(root, "headers.json"), "utf8"));
const content = readFileSync(path.join(root, "source", files[0][1]), "utf8");
const run = text => importFile(text, "plane", files[0][1], headers);

test("pinned catalogue has exactly 246 rows and retains its content fingerprint", () => {
  const rows = catalogue();
  assert.equal(rows.length, 246);
  assert.deepEqual(files.map(([category]) => rows.filter(row => row.category === category).length), [2, 32, 212]);
  assert.equal(new Set(rows.map(row => row.id)).size, 246);
  const json = JSON.stringify(rows, null, 2) + "\n";
  assert.equal(readFileSync(path.join(root, "catalogue.json"), "utf8"), json);
  assert.equal(createHash("sha256").update(json).digest("hex"), "c7571856e6de7ec6fe3a3f754715a16531ff4168d1515d657b560f3649c123f1");
});

test("all encoded rows round trip with empty columns and requirement operators intact", () => {
  for (const [category, file] of files) {
    const text = readFileSync(path.join(root, "source", file), "utf8");
    const source = text.trimEnd().split("\n").slice(1).map(line => line.split("\t"));
    importFile(text, category, file, headers).forEach((row, i) => {
      assert.equal(row.originalRaw.split("\t").join(" | "), source[i][2]);
      assert.equal(row.suggestedRaw.split("\t").join(" | "), source[i][3]);
      assert.equal(row.alsoDiffers, source[i][5]);
      assert.equal(row.source, source[i][6]);
    });
  }
  assert.equal(decodeRow("a |  |  | 1||2 | "), "a\t\t\t1||2\t");
});

test("IDs ignore line references and distinguish identical occurrences deterministically", () => {
  assert.deepEqual(run(content), run(content));
  const lines = content.trimEnd().split("\n");
  const cells = lines[1].split("\t"); cells[1] = "99999";
  assert.equal(run([lines[0], cells.join("\t")].join("\n"))[0].id, run(content)[0].id);
  const duplicate = run([lines[0], lines[1], lines[1]].join("\n"));
  assert.equal(duplicate[1].id, duplicate[0].id + "-2");
});

test("malformed records fail with file and source line", () => {
  assert.throws(() => run("bad headers"), /expected seven/);
  assert.throws(() => run(content + "\n"), /:4: expected 7 columns/);
  for (const [column, value, message] of [[0, "unknown.tsv", /unknown upstream file/], [1, "0", /positive integer/],
    [2, "1 2 4", /malformed Destination/], [3, "", /no endpoints/], [6, "", /Source must be explicit/]]) {
    const lines = content.trimEnd().split("\n"), cells = lines[1].split("\t"); cells[column] = value;
    assert.throws(() => run([lines[0], cells.join("\t")].join("\n")), message);
  }
});

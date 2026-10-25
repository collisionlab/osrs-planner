import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { catalogue, decodeRow, files, importFile, importAdditions, itemGroups, root } from "./import-candidates.mjs";

const headers = JSON.parse(readFileSync(path.join(root, "headers.json"), "utf8"));
const content = readFileSync(path.join(root, "source", files[0][1]), "utf8");
const run = text => importFile(text, "plane", files[0][1], headers);

test("pinned catalogue has all 4635 rows and preserves the original geometry IDs", () => {
  const rows = catalogue();
  assert.equal(rows.length, 4635);
  assert.deepEqual(files.map(([category]) => rows.filter(row => row.category === category).length), files.map(([, , count]) => count));
  assert.equal(new Set(rows.map(row => row.id)).size, 4635);
  const json = JSON.stringify(rows, null, 2) + "\n";
  assert.equal(readFileSync(path.join(root, "catalogue.json"), "utf8"), json);
  assert.equal(createHash("sha256").update(json).digest("hex"), "276b0fbb5b6ce5e3362c6ab9a29846bdb9f5d1a2e0c8a389c09f7f64c1cf5fe6");
  assert.equal(createHash("sha256").update(JSON.stringify(rows.slice(0, 246), null, 2) + "\n").digest("hex"),
    "c7571856e6de7ec6fe3a3f754715a16531ff4168d1515d657b560f3649c123f1");
});

test("all encoded rows round trip with empty columns and requirement operators intact", () => {
  for (const [category, file] of files.filter(([, , , kind]) => !kind)) {
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

test("all new proposals retain the complete source record, schema and unchecked evidence", () => {
  for (const [category, file, count, kind] of files.filter(([, , , kind]) => kind)) {
    const text = readFileSync(path.join(root, "source", file), "utf8");
    const lines = text.trimEnd().split("\n"), header = lines.shift();
    const imported = importAdditions(text, category, file, kind);
    assert.equal(imported.length, count);
    imported.forEach((row, index) => {
      assert.equal(row.sourceRaw, lines[index]); assert.equal(row.sourceHeader, header);
      const cells = lines[index].split("\t");
      assert.equal(row.suggestedRaw + "\t" + [row.needs, row.uncheckedTicks, row.source].join("\t"), lines[index]);
      assert.equal(row.originalRaw, null); assert.equal(row.file, null);
      assert.equal(row.source, cells.at(-1));
    });
    assert.deepEqual(imported, importAdditions(text, category, file, kind));
  }
});

test("unrepresentable requirements remain notes with an empty suggested row", () => {
  const notes = catalogue().filter(row => row.category === "unrepresentable_requirements");
  assert.equal(notes.length, 39);
  assert.ok(notes.every(row => row.originalRaw && row.suggestedRaw === ""));
});

test("supporting item group definitions remain evidence rather than resolved requirements", () => {
  const groups = itemGroups();
  assert.equal(groups.length, 9);
  assert.equal(JSON.stringify(groups, null, 2) + "\n", readFileSync(path.join(root, "item-groups.json"), "utf8"));
  assert.equal(groups[0].name, "light source");
  assert.ok(groups[0].itemIds.startsWith("33,32,594,"));
  assert.equal(groups[0].raw, [groups[0].name, groups[0].itemIds, groups[0].itemNames].join("\t"));
});

test("malformed new proposals are rejected explicitly", () => {
  const file = "3b new transports - Wiki or cache source - network stops.tsv";
  const [header, line] = readFileSync(path.join(root, "source", file), "utf8").split("\n");
  const run = text => importAdditions(text, "network_stop", file, "network_stop");
  assert.throws(() => run("bad\n" + line), /unexpected proposal columns/);
  assert.throws(() => run(header + "\n" + line + "\textra"), /expected 14 columns/);
  const cells = line.split("\t"); cells[1] = "1 2 4";
  assert.throws(() => run(header + "\n" + cells.join("\t")), /malformed Board at/);
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

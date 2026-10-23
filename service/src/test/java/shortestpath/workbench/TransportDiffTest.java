package shortestpath.workbench;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

class TransportDiffTest {
    static final String HEADER = "# Origin\tDestination\tmenuOption menuTarget objectID\tSkills\tDuration";
    static final String FILE = "src/main/resources/transports/agility_shortcuts.tsv";

    static String tsv(String... lines) {
        return HEADER + "\n" + String.join("\n", lines);
    }

    @Test
    void parsesRowsByTheFilesOwnHeaderWithTheCommentAboveAsSection() {
        TransportDiff.Row row = TransportDiff.parse(FILE,
            tsv("# shortcut: northern gap\t\t\tPending", "3216 12441 0\t3222 12441 0\tPass Tight Gap 36693\t78 Agility\t")).get(0);
        assertEquals(3, row.line);
        assertEquals("shortcut: northern gap", row.section);
        assertEquals("Pass Tight Gap 36693", row.label);
        assertEquals("3216 12441 0", row.origin.toString());
        assertEquals("3222 12441 0", row.destination.toString());
        assertEquals("78 Agility", row.fields.get("Skills"));
    }

    @Test
    void findsAddedRemovedAndChangedRowsAndKeepsASlightlyMovedTileAsAnEdit() {
        List<TransportDiff.Row> base = TransportDiff.parse(FILE, tsv("1 1 0\t2 1 0\tOpen Door 1\t\t",
            "5 5 0\t6 5 0\tOpen Gate 2\t\t1", "9 9 0\t9 9 1\tClimb-up Ladder 3\t\t"));
        List<TransportDiff.Row> head = TransportDiff.parse(FILE, tsv("1 1 0\t2 1 0\tOpen Door 1\t\t",
            "5 5 0\t6 5 0\tOpen Gate 2\t\t2", "9 9 0\t9 10 1\tClimb-up Ladder 3\t\t", "20 20 0\t21 20 0\tSqueeze Gap 4\t\t"));
        List<TransportDiff.Change> changes = TransportDiff.diff(base, head);
        assertEquals(List.of("changed 3", "changed 4", "added 5"),
            changes.stream().map(change -> change.kind + " " + change.row().line).collect(Collectors.toList()));
        assertEquals("Duration 1>2", field(changes.get(0)));
        assertEquals("Destination 9 9 1>9 10 1", field(changes.get(1)));
        assertEquals(List.of("changed", "changed", "removed"),
            TransportDiff.diff(head, base).stream().map(change -> change.kind).collect(Collectors.toList()));
    }

    private static String field(TransportDiff.Change change) {
        TransportDiff.FieldChange field = change.fields.get(0);
        assertEquals(1, change.fields.size());
        return field.name + " " + field.before + ">" + field.after;
    }

    @Test
    void groupsAShortcutWithItsWayBackButNotWithUnrelatedRowsOfTheSameSection() {
        List<TransportDiff.Row> head = TransportDiff.parse(FILE, tsv("## Gaps", "100 100 0\t106 100 0\tPass Gap 1\t\t",
            "106 100 0\t100 100 0\tPass Gap 2\t\t", "300 300 0\t301 300 0\tOpen Door 3\t\t"));
        List<TransportDiff.Unit> units = TransportDiff.group(FILE, TransportDiff.diff(List.of(), head));
        assertEquals(List.of("agility_shortcuts-3 Gaps 2", "agility_shortcuts-5 Gaps 1"),
            units.stream().map(unit -> unit.id + " " + unit.title + " " + unit.changes.size()).collect(Collectors.toList()));
    }

    @Test
    void coversTransportAndDestinationTablesButNotGeneratedOnes() {
        List<TransportDiff.Unit> units = TransportDiff.units(List.of(
            new TransportDiff.FileVersions(FILE, null, tsv("1 1 0\t2 1 0\tOpen Door 1\t\t")),
            new TransportDiff.FileVersions("src/main/resources/transports/teleport_restrictions.tsv", null, tsv("1 1 0\t2 1 0\tx\t\t")),
            new TransportDiff.FileVersions("README.md", null, "x")));
        assertEquals(List.of(FILE), units.stream().map(unit -> unit.file).collect(Collectors.toList()));
    }
}

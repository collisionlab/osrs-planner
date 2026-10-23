package shortestpath.workbench;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Row-level diffs of the plugin's transport and destination TSVs, grouped into review units: the
 * rows a reviewer checks together, such as a shortcut and its way back, or every tile of one
 * teleport platform.
 */
public final class TransportDiff {
    static final String ORIGIN = "Origin", DESTINATION = "Destination", OBJECT = "menuOption menuTarget objectID", INFO = "Info";
    /** Endpoints this close (in tiles, any plane) put two rows of one section in the same unit. */
    static final int NEAR = 4;
    /** A removed and an added row with the same label and endpoints this close are one edit. */
    static final int MOVED = 3;

    private static final Pattern REVIEWED = Pattern.compile("^src/main/resources/(transports|destinations)/.+\\.tsv$");
    private static final Pattern INTEGER = Pattern.compile("^-?\\d+$");

    private TransportDiff() { }

    public static final class Point {
        public final int x, y, plane;

        Point(int x, int y, int plane) {
            this.x = x;
            this.y = y;
            this.plane = plane;
        }

        @Override
        public boolean equals(Object other) {
            return other instanceof Point && ((Point) other).x == x && ((Point) other).y == y && ((Point) other).plane == plane;
        }

        @Override
        public int hashCode() {
            return Objects.hash(x, y, plane);
        }

        @Override
        public String toString() {
            return x + " " + y + " " + plane;
        }
    }

    /** One data row of a TSV, by the column names in the file's header. */
    public static final class Row {
        public final String file;
        /** 1-based line in the file. */
        public final int line;
        /** The nearest comment above the row ({@code ## Trahaearn Mine}), without the {@code #}s. */
        public final String section;
        public final Map<String, String> fields;
        public final Point origin, destination;
        /** {@code menuOption menuTarget objectID}, or the destination file's {@code Info}. */
        public final String label;

        Row(String file, int line, String section, Map<String, String> fields) {
            this.file = file;
            this.line = line;
            this.section = section;
            this.fields = fields;
            this.origin = point(fields.get(ORIGIN));
            this.destination = point(fields.get(DESTINATION));
            String object = fields.getOrDefault(OBJECT, "");
            this.label = !object.isEmpty() ? object : fields.getOrDefault(INFO, "");
        }

        String key() {
            return (origin == null ? "" : origin) + ">" + (destination == null ? "" : destination) + "|" + label;
        }
    }

    public static final class FieldChange {
        public final String name, before, after;

        FieldChange(String name, String before, String after) {
            this.name = name;
            this.before = before;
            this.after = after;
        }
    }

    public static final class Change {
        /** {@code added}, {@code removed} or {@code changed}. */
        public final String kind;
        public final Row base, head;
        /** For changed rows: the fields that differ, origin and destination included. */
        public final List<FieldChange> fields;

        Change(String kind, Row base, Row head, List<FieldChange> fields) {
            this.kind = kind;
            this.base = base;
            this.head = head;
            this.fields = fields;
        }

        Row row() {
            return head != null ? head : base;
        }
    }

    public static final class Unit {
        /** Stable across loads of the same diff: file and first line. */
        public final String id;
        public final String file, title;
        public final List<Change> changes;

        Unit(String id, String file, String title, List<Change> changes) {
            this.id = id;
            this.file = file;
            this.title = title;
            this.changes = changes;
        }
    }

    /** The files a review covers: every transport and destination table except generated ones. */
    public static boolean isReviewedFile(String path) {
        return REVIEWED.matcher(path).matches() && !path.endsWith("/teleport_restrictions.tsv");
    }

    static Point point(String value) {
        if (value == null) {
            return null;
        }
        String[] parts = value.trim().split("\\s+");
        if (parts.length != 3) {
            return null;
        }
        for (String part : parts) {
            if (!INTEGER.matcher(part).matches()) {
                return null;
            }
        }
        return new Point(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]), Integer.parseInt(parts[2]));
    }

    /** The data rows of one TSV, keyed by its header line (the plugin's own reader does the same). */
    public static List<Row> parse(String file, String text) {
        String[] lines = text.split("\r?\n", -1);
        String[] headers = (lines.length > 0 ? lines[0] : "").replaceFirst("^#\\s?", "").split("\t", -1);
        for (int i = 0; i < headers.length; i++) {
            headers[i] = headers[i].trim();
        }
        List<Row> rows = new ArrayList<>();
        if (!List.of(headers).contains(DESTINATION)) {
            return rows;
        }
        String section = "";
        for (int index = 1; index < lines.length; index++) {
            String line = lines[index];
            if (line.isBlank()) {
                continue;
            }
            if (line.startsWith("#")) {
                String comment = line.split("\t", -1)[0].replaceFirst("^#+\\s*", "").trim();
                section = comment.isEmpty() ? section : comment;
                continue;
            }
            String[] parts = line.split("\t", -1);
            Map<String, String> fields = new LinkedHashMap<>();
            for (int column = 0; column < headers.length; column++) {
                fields.put(headers[column], column < parts.length ? parts[column].trim() : "");
            }
            rows.add(new Row(file, index + 1, section, fields));
        }
        return rows;
    }

    static int distance(Point a, Point b) {
        if (a == null && b == null) {
            return 0;
        }
        if (a == null || b == null) {
            return Integer.MAX_VALUE;
        }
        return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    }

    private static List<FieldChange> fieldChanges(Row base, Row head) {
        Set<String> names = new LinkedHashSet<>(base.fields.keySet());
        names.addAll(head.fields.keySet());
        List<FieldChange> changes = new ArrayList<>();
        for (String name : names) {
            String before = base.fields.getOrDefault(name, ""), after = head.fields.getOrDefault(name, "");
            if (!before.equals(after)) {
                changes.add(new FieldChange(name, before, after));
            }
        }
        return changes;
    }

    /** Rows added, removed and changed between two versions of one file, in line order. */
    public static List<Change> diff(List<Row> base, List<Row> head) {
        Map<String, List<Row>> unmatched = new LinkedHashMap<>();
        for (Row row : base) {
            unmatched.computeIfAbsent(row.key(), key -> new ArrayList<>()).add(row);
        }
        List<Change> changes = new ArrayList<>();
        List<Row> added = new ArrayList<>();
        for (Row row : head) {
            List<Row> candidates = unmatched.get(row.key());
            if (candidates == null || candidates.isEmpty()) {
                added.add(row);
                continue;
            }
            Row match = candidates.remove(0);
            List<FieldChange> fields = fieldChanges(match, row);
            if (!fields.isEmpty()) {
                changes.add(new Change("changed", match, row, fields));
            }
        }
        List<Row> removed = new ArrayList<>();
        unmatched.values().forEach(removed::addAll);
        // A row whose tile moved a little is an edit of that row, the most common fix, not a new transport.
        for (Row row : added) {
            Row old = null;
            for (Row candidate : removed) {
                if (candidate.label.equals(row.label) && candidate.section.equals(row.section)
                        && distance(candidate.origin, row.origin) <= MOVED && distance(candidate.destination, row.destination) <= MOVED) {
                    old = candidate;
                    break;
                }
            }
            if (old == null) {
                changes.add(new Change("added", null, row, List.of()));
                continue;
            }
            removed.remove(old);
            changes.add(new Change("changed", old, row, fieldChanges(old, row)));
        }
        for (Row row : removed) {
            changes.add(new Change("removed", row, null, List.of()));
        }
        changes.sort(Comparator.comparingInt(change -> change.row().line));
        return changes;
    }

    private static List<Point> ends(Change change) {
        List<Point> points = new ArrayList<>(4);
        for (Row row : new Row[]{change.head, change.base}) {
            if (row != null) {
                if (row.origin != null) {
                    points.add(row.origin);
                }
                if (row.destination != null) {
                    points.add(row.destination);
                }
            }
        }
        return points;
    }

    private static boolean near(Change a, Change b) {
        for (Point p : ends(a)) {
            for (Point q : ends(b)) {
                if (distance(p, q) <= NEAR) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Units of one file's changes: rows under the same comment whose endpoints are within a few tiles
     * of each other, joined transitively, so a ladder and its way back, or a platform's nine tiles, are one.
     */
    public static List<Unit> group(String file, List<Change> changes) {
        int[] parent = new int[changes.size()];
        for (int i = 0; i < parent.length; i++) {
            parent[i] = i;
        }
        for (int a = 0; a < changes.size(); a++) {
            for (int b = a + 1; b < changes.size(); b++) {
                if (changes.get(a).row().section.equals(changes.get(b).row().section) && near(changes.get(a), changes.get(b))) {
                    parent[find(parent, b)] = find(parent, a);
                }
            }
        }
        Map<Integer, List<Change>> members = new LinkedHashMap<>();
        for (int i = 0; i < changes.size(); i++) {
            members.computeIfAbsent(find(parent, i), root -> new ArrayList<>()).add(changes.get(i));
        }
        String name = file.substring(file.lastIndexOf('/') + 1);
        List<Unit> units = new ArrayList<>();
        for (List<Change> unit : members.values()) {
            Row first = unit.get(0).row();
            String title = !first.section.isEmpty() ? first.section : !first.label.isEmpty() ? first.label : name;
            units.add(new Unit(name.replaceFirst("\\.tsv$", "") + "-" + first.line, file, title, unit));
        }
        return units;
    }

    private static int find(int[] parent, int index) {
        while (parent[index] != index) {
            parent[index] = parent[parent[index]];
            index = parent[index];
        }
        return index;
    }

    /** One file at both ends of a diff; {@code null} where it doesn't exist. */
    public static final class FileVersions {
        final String path, base, head;

        public FileVersions(String path, String base, String head) {
            this.path = path;
            this.base = base;
            this.head = head;
        }
    }

    /** Every unit of a diff, in file and line order. */
    public static List<Unit> units(List<FileVersions> files) {
        List<FileVersions> sorted = new ArrayList<>(files);
        sorted.sort(Comparator.comparing(file -> file.path));
        List<Unit> units = new ArrayList<>();
        for (FileVersions file : sorted) {
            if (!isReviewedFile(file.path)) {
                continue;
            }
            List<Row> base = file.base == null ? List.of() : parse(file.path, file.base);
            List<Row> head = file.head == null ? List.of() : parse(file.path, file.head);
            units.addAll(group(file.path, diff(base, head)));
        }
        return units;
    }

    /** Rows of each kind across units. */
    public static Map<String, Integer> counts(List<Unit> units) {
        Map<String, Integer> counts = new HashMap<>(Map.of("added", 0, "removed", 0, "changed", 0));
        for (Unit unit : units) {
            for (Change change : unit.changes) {
                counts.merge(change.kind, 1, Integer::sum);
            }
        }
        return counts;
    }
}

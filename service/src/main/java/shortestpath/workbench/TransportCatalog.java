package shortestpath.workbench;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.IntFunction;
import java.util.function.Predicate;
import java.util.stream.Collectors;
import shortestpath.WorldPointUtil;
import shortestpath.poh.PohService;
import shortestpath.requirement.model.VarRequirement;
import shortestpath.routeapi.RouteApi;
import shortestpath.routeapi.RoutePlans;
import shortestpath.transport.ResourceLoader;
import shortestpath.transport.Transport;
import shortestpath.transport.TransportType;

/**
 * The plugin's effective transports, as its own loader builds them, each traced back to the TSV rows
 * it came from: one row, or (for networks such as fairy rings) an origin row paired with a
 * destination row, with the plugin's remapping of destinations inside a player-owned house noted.
 *
 * <p>Transports are loaded exactly as {@code PluginResources.transports()} loads them, one resource at
 * a time through {@link ResourceLoader#addTransportsFromContents} (which is what
 * {@link ResourceLoader#transports()} calls per file) so each knows its file, then
 * {@link PohService#remapPohDestinations}. Nothing here decides what a row means; rows are only
 * matched to the transports the plugin made of them. {@code TransportCatalogTest} checks the result
 * is the same set the router uses.
 */
public final class TransportCatalog {
    static final String RESOURCES = "src/main/resources";
    /** Index cells, in tiles a side. */
    private static final int CELL_SHIFT = 6;
    /** A view with more transports than this answers with counts per area instead. */
    public static final int VIEW_LIMIT = 800;
    /** Cluster cells a box is split into at most, about. */
    static final int CLUSTER_CELLS = 160;
    public static final int SEARCH_LIMIT = 50;

    /** A world tile. */
    public static final class Point {
        public final int x, y, plane;

        Point(int x, int y, int plane) {
            this.x = x;
            this.y = y;
            this.plane = plane;
        }

        static Point unpack(int packed) {
            if (packed == Transport.UNDEFINED_ORIGIN || packed == Transport.LOCATION_PERMUTATION) {
                return null;
            }
            return new Point(WorldPointUtil.unpackWorldX(packed), WorldPointUtil.unpackWorldY(packed), WorldPointUtil.unpackWorldPlane(packed));
        }

        static Point of(TransportDiff.Point point) {
            return point == null ? null : new Point(point.x, point.y, point.plane);
        }

        boolean same(TransportDiff.Point other) {
            return other != null && other.x == x && other.y == y && other.plane == plane;
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

    /** A rectangle of tiles on one plane, inclusive. */
    public static final class Box {
        public final int plane, x1, y1, x2, y2;

        public Box(int plane, int x1, int y1, int x2, int y2) {
            this.plane = plane;
            this.x1 = Math.min(x1, x2);
            this.y1 = Math.min(y1, y2);
            this.x2 = Math.max(x1, x2);
            this.y2 = Math.max(y1, y2);
        }

        boolean contains(Point point) {
            return point != null && point.plane == plane && point.x >= x1 && point.x <= x2 && point.y >= y1 && point.y <= y2;
        }

        long area() {
            return (long) (x2 - x1 + 1) * (y2 - y1 + 1);
        }
    }

    /** Where an effective transport came from. */
    public static final class Source {
        /** {@code row}: the transport is this row; {@code origin}/{@code destination}: one half of a pairing. */
        public final String role;
        public final String file, section;
        public final int line;
        /** The row's columns as written. */
        public final Map<String, String> fields;

        Source(String role, TransportDiff.Row row) {
            this.role = role;
            this.file = row.file;
            this.section = row.section;
            this.line = row.line;
            this.fields = row.fields;
        }
    }

    /** One effective transport, as a list or the map shows it. */
    public static class Summary {
        public final String id, type, file;
        /** Null for a teleport, which leaves from anywhere. */
        public final Point origin;
        public final Point destination;
        /** {@code objectInfo} for an object, else the display info. */
        public final String label;
        public final boolean teleport;
        /** {@code row}, {@code paired} (an origin row with a destination row), or {@code teleport}. */
        public final String construction;
        /** The destination before the plugin moved it to the house's landing tile, or null. */
        public final Point remappedFrom;

        Summary(Entry entry) {
            this.id = entry.id;
            this.type = entry.transport.getType().name();
            this.file = entry.file;
            this.origin = entry.origin;
            this.destination = entry.destination;
            this.label = entry.label();
            this.teleport = entry.origin == null;
            this.construction = entry.construction;
            this.remappedFrom = entry.remappedFrom;
        }
    }

    /** Everything known about one effective transport. */
    public static final class Detail extends Summary {
        public final String objectInfo, displayInfo;
        public final int duration;
        public final boolean consumable;
        /** -1 when any wilderness level will do. */
        public final int maxWildernessLevel;
        public final List<RouteApi.Capability> requirements;
        /** Game state checks, as {@code varbit 1234 = 5}. */
        public final List<String> varChecks;
        public final List<Source> sources;

        Detail(Entry entry, IntFunction<String> itemName) {
            super(entry);
            Transport transport = entry.transport;
            this.objectInfo = transport.getObjectInfo();
            this.displayInfo = transport.getDisplayInfo();
            this.duration = transport.getDuration();
            this.consumable = transport.isConsumable();
            this.maxWildernessLevel = transport.getMaxWildernessLevel();
            this.requirements = RoutePlans.requirements(transport, itemName);
            this.varChecks = transport.getVarRequirements().stream().map(TransportCatalog::describe).sorted().collect(Collectors.toList());
            this.sources = entry.sources;
        }
    }

    /** Transports somewhere in a cluster's bounds, too many to list at this zoom. */
    public static final class Cluster {
        public final int plane, x1, y1, x2, y2, count;

        Cluster(int plane, int x1, int y1, int x2, int y2, int count) {
            this.plane = plane;
            this.x1 = x1;
            this.y1 = y1;
            this.x2 = x2;
            this.y2 = y2;
            this.count = count;
        }
    }

    /** The transports with an end in a view: listed, or counted by area when there are too many. */
    public static final class View {
        public final int total;
        public final List<Summary> transports;
        public final List<Cluster> clusters;

        View(int total, List<Summary> transports, List<Cluster> clusters) {
            this.total = total;
            this.transports = transports;
            this.clusters = clusters;
        }
    }

    /** One file's and one type's share of the catalogue. */
    public static final class TypeCount {
        public final String type;
        public final int count;
        public final boolean teleport;

        TypeCount(String type, int count, boolean teleport) {
            this.type = type;
            this.count = count;
            this.teleport = teleport;
        }
    }

    static final class Entry {
        String id;
        final Transport transport;
        final String file;
        final Point origin, destination, remappedFrom;
        final String construction;
        final List<Source> sources;

        Entry(Transport transport, String file, Point remappedFrom, String construction, List<Source> sources) {
            this.transport = transport;
            this.file = file;
            this.origin = Point.unpack(transport.getOrigin());
            this.destination = Point.unpack(transport.getDestination());
            this.remappedFrom = remappedFrom;
            this.construction = construction;
            this.sources = sources;
        }

        String label() {
            String object = transport.getObjectInfo(), info = transport.getDisplayInfo();
            return object != null && !object.isEmpty() ? object : info != null ? info : "";
        }
    }

    private final List<Entry> entries;
    private final Map<String, Entry> byId = new HashMap<>();
    /** Each transport under the cells of both of its ends. */
    private final Map<Long, List<Entry>> cells = new HashMap<>();
    private final IntFunction<String> itemName;

    TransportCatalog(List<Entry> entries, IntFunction<String> itemName) {
        this.entries = entries;
        this.itemName = itemName;
        Map<String, Integer> seen = new HashMap<>();
        for (Entry entry : entries) {
            String id = entry.id;
            int n = seen.merge(id, 1, Integer::sum);
            if (n > 1) {
                // Identical rows (a file listing one transport twice) stay distinguishable.
                entry.id = id + "-" + n;
            }
            byId.put(entry.id, entry);
            for (Point end : new Point[] {entry.origin, entry.destination}) {
                if (end != null) {
                    List<Entry> cell = cells.computeIfAbsent(cell(end.plane, end.x >> CELL_SHIFT, end.y >> CELL_SHIFT), key -> new ArrayList<>());
                    if (cell.isEmpty() || cell.get(cell.size() - 1) != entry) {
                        cell.add(entry);
                    }
                }
            }
        }
    }

    /** The catalogue of the plugin on the classpath. */
    public static TransportCatalog load(IntFunction<String> itemName) {
        Map<String, String> files = new LinkedHashMap<>();
        for (TransportType type : TransportType.values()) {
            if (type.hasResourcePath()) {
                files.put(type.name(), resource(type.getResourcePath()));
            }
        }
        return build(files, itemName);
    }

    /** The catalogue of these transport files, by {@link TransportType} name; for tests. */
    static TransportCatalog build(Map<String, String> contentsByType, IntFunction<String> itemName) {
        Map<Integer, Set<Transport>> all = new HashMap<>();
        // Each file's transports in the order the plugin made them: rows in file order, then pairings.
        Map<String, List<Transport>> byFile = new LinkedHashMap<>();
        Map<String, List<TransportDiff.Row>> rowsByFile = new HashMap<>();
        for (Map.Entry<String, String> file : contentsByType.entrySet()) {
            TransportType type = TransportType.valueOf(file.getKey());
            String path = RESOURCES + type.getResourcePath();
            Map<Integer, Set<Transport>> own = new HashMap<>();
            ResourceLoader.addTransportsFromContents(own, file.getValue(), type, type.hasRadiusThreshold() ? type.getRadiusThreshold() : 0);
            List<Transport> made = byFile.computeIfAbsent(path, key -> new ArrayList<>());
            own.forEach((origin, transports) -> {
                all.computeIfAbsent(origin, key -> new LinkedHashSet<>()).addAll(transports);
                made.addAll(transports);
            });
            rowsByFile.put(path, TransportDiff.parse(path, file.getValue()));
        }
        Map<Transport, Integer> before = new IdentityHashMap<>();
        all.values().forEach(set -> set.forEach(transport -> before.put(transport, transport.getDestination())));
        PohService.remapPohDestinations(all);

        List<Entry> entries = new ArrayList<>();
        for (Map.Entry<String, List<Transport>> file : byFile.entrySet()) {
            // Rows already matched, so transports that look alike (one teleport with several sets of
            // requirements) take one row each, in order.
            Set<TransportDiff.Row> used = Collections.newSetFromMap(new IdentityHashMap<>());
            for (Transport transport : file.getValue()) {
                int original = before.get(transport);
                Point remappedFrom = original != transport.getDestination() ? Point.unpack(original) : null;
                entries.add(trace(transport, file.getKey(), Point.unpack(original), remappedFrom, rowsByFile.get(file.getKey()), used));
            }
        }
        entries.sort(Comparator.comparing((Entry entry) -> entry.file).thenComparing(entry -> entry.sources.isEmpty() ? 0 : entry.sources.get(0).line)
            .thenComparing(entry -> entry.id));
        return new TransportCatalog(entries, itemName);
    }

    /** Matches a transport to the rows the plugin built it from. */
    private static Entry trace(Transport transport, String file, Point destination, Point remappedFrom, List<TransportDiff.Row> rows,
            Set<TransportDiff.Row> used) {
        Point origin = Point.unpack(transport.getOrigin());
        String object = Objects.toString(transport.getObjectInfo(), ""), info = Objects.toString(transport.getDisplayInfo(), "");
        List<Source> sources = new ArrayList<>();
        String construction;
        if (origin == null) {
            construction = "teleport";
            first(rows, used, row -> row.origin == null && destination.same(row.destination) && matches(row, object, info))
                .ifPresent(row -> sources.add(new Source("row", row)));
        } else {
            TransportDiff.Row direct = first(rows, used, row -> origin.same(row.origin) && destination.same(row.destination) && matches(row, object, info))
                .orElse(null);
            if (direct != null) {
                construction = "row";
                sources.add(new Source("row", direct));
            } else {
                // An origin row (no destination) paired with a destination row (no origin), such as
                // one fairy ring with another: the object is the origin's, the display info the destination's.
                construction = "paired";
                rows.stream().filter(row -> origin.same(row.origin) && blank(row, TransportDiff.DESTINATION)
                    && field(row, TransportDiff.OBJECT).equals(object)).findFirst().ifPresent(row -> sources.add(new Source("origin", row)));
                rows.stream().filter(row -> blank(row, TransportDiff.ORIGIN) && destination.same(row.destination)
                    && field(row, "Display info").equals(info)).findFirst().ifPresent(row -> sources.add(new Source("destination", row)));
            }
        }
        Entry entry = new Entry(transport, file, remappedFrom, construction, sources);
        entry.id = id(transport.getType().name(), file, origin, destination, object, info,
            sources.stream().map(source -> source.fields.toString()).collect(Collectors.joining("\u0000")));
        return entry;
    }

    /** The first row passing {@code test} not yet taken by another transport (which it then takes), else the first. */
    private static Optional<TransportDiff.Row> first(List<TransportDiff.Row> rows, Set<TransportDiff.Row> used,
            Predicate<TransportDiff.Row> test) {
        TransportDiff.Row fallback = null;
        for (TransportDiff.Row row : rows) {
            if (test.test(row)) {
                if (used.add(row)) {
                    return Optional.of(row);
                }
                fallback = fallback == null ? row : fallback;
            }
        }
        return Optional.ofNullable(fallback);
    }

    private static boolean matches(TransportDiff.Row row, String object, String info) {
        return field(row, TransportDiff.OBJECT).equals(object) && field(row, "Display info").equals(info);
    }

    private static String field(TransportDiff.Row row, String name) {
        return row.fields.getOrDefault(name, "");
    }

    /** A column the file has, left empty (the plugin's "pair with every row of the other kind"). */
    private static boolean blank(TransportDiff.Row row, String name) {
        return row.fields.containsKey(name) && row.fields.get(name).isEmpty();
    }

    /**
     * Stable for the same transport across loads and edits elsewhere in its file: its type, file, ends,
     * labels, and the contents of the rows it came from (which tell apart one teleport's variants).
     */
    static String id(String type, String file, Point origin, Point destination, String object, String info, String rows) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(String.join("\u0000", type, file, String.valueOf(origin), String.valueOf(destination), object, info, rows)
                .getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (int i = 0; i < 6; i++) {
                hex.append(String.format("%02x", hash[i]));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String describe(VarRequirement requirement) {
        String kind = requirement.getVarType() == null ? "var" : requirement.getVarType().name().toLowerCase().replace('_', ' ');
        return kind + " " + requirement.getId() + " " + requirement.getCheckType() + " " + requirement.getValue();
    }

    private static String resource(String path) {
        try (InputStream stream = Objects.requireNonNull(ResourceLoader.class.getResourceAsStream(path), path)) {
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static long cell(int plane, int cx, int cy) {
        return ((long) plane << 40) | ((long) (cx & 0xFFFFF) << 20) | (cy & 0xFFFFF);
    }

    int size() {
        return entries.size();
    }

    List<Entry> entries() {
        return Collections.unmodifiableList(entries);
    }

    /** Every transport type, with how many effective transports it has. */
    public List<TypeCount> types() {
        Map<String, Integer> counts = new TreeMap<>();
        Map<String, Boolean> teleport = new HashMap<>();
        for (Entry entry : entries) {
            counts.merge(entry.transport.getType().name(), 1, Integer::sum);
            teleport.merge(entry.transport.getType().name(), entry.origin == null, Boolean::logicalOr);
        }
        return counts.entrySet().stream().map(count -> new TypeCount(count.getKey(), count.getValue(), teleport.get(count.getKey())))
            .collect(Collectors.toList());
    }

    public Detail detail(String id) {
        Entry entry = byId.get(id);
        if (entry == null) {
            throw new Reviews.NotFound("no transport " + id);
        }
        return new Detail(entry, itemName);
    }

    /**
     * The transports of the given types (all when empty) with an end in any of the boxes: listed when
     * there are at most {@code limit}, else counted in cells of each box.
     */
    public View view(List<Box> boxes, Set<String> types, int limit) {
        Set<Entry> found = Collections.newSetFromMap(new IdentityHashMap<>());
        for (Box box : boxes) {
            for (int cx = box.x1 >> CELL_SHIFT; cx <= box.x2 >> CELL_SHIFT; cx++) {
                for (int cy = box.y1 >> CELL_SHIFT; cy <= box.y2 >> CELL_SHIFT; cy++) {
                    for (Entry entry : cells.getOrDefault(cell(box.plane, cx, cy), List.of())) {
                        if ((types.isEmpty() || types.contains(entry.transport.getType().name()))
                                && (box.contains(entry.origin) || box.contains(entry.destination))) {
                            found.add(entry);
                        }
                    }
                }
            }
        }
        if (found.size() <= limit) {
            List<Summary> listed = found.stream().sorted(Comparator.comparing((Entry entry) -> entry.file).thenComparing(entry -> entry.id))
                .map(Summary::new).collect(Collectors.toList());
            return new View(found.size(), listed, List.of());
        }
        return new View(found.size(), List.of(), clusters(boxes, found));
    }

    /** Counts per cell of each box, each transport once, under its first end in a box. */
    private static List<Cluster> clusters(List<Box> boxes, Set<Entry> found) {
        Map<String, int[]> counts = new LinkedHashMap<>();
        for (Entry entry : found) {
            for (Box box : boxes) {
                Point end = box.contains(entry.origin) ? entry.origin : box.contains(entry.destination) ? entry.destination : null;
                if (end == null) {
                    continue;
                }
                int size = clusterSize(box);
                int cx = Math.floorDiv(end.x - box.x1, size), cy = Math.floorDiv(end.y - box.y1, size);
                int[] cluster = counts.computeIfAbsent(boxes.indexOf(box) + ":" + cx + ":" + cy,
                    key -> new int[] {box.plane, end.x, end.y, end.x, end.y, 0});
                cluster[1] = Math.min(cluster[1], end.x);
                cluster[2] = Math.min(cluster[2], end.y);
                cluster[3] = Math.max(cluster[3], end.x);
                cluster[4] = Math.max(cluster[4], end.y);
                cluster[5]++;
                break;
            }
        }
        return counts.values().stream().map(c -> new Cluster(c[0], c[1], c[2], c[3], c[4], c[5])).collect(Collectors.toList());
    }

    /** A box's cluster cell side, in tiles: a power of two that splits it into about {@link #CLUSTER_CELLS}. */
    static int clusterSize(Box box) {
        int size = 8;
        while (box.area() / ((long) size * size) > CLUSTER_CELLS) {
            size *= 2;
        }
        return size;
    }

    /**
     * Transports by object id (a number), by tile ({@code x y plane}: either end), or by text in their
     * object or display info; at most {@link #SEARCH_LIMIT}.
     */
    public List<Summary> search(String query, Set<String> types) {
        String q = query.trim();
        if (q.isEmpty()) {
            return List.of();
        }
        TransportDiff.Point tile = TransportDiff.point(q.replace(',', ' '));
        String lower = q.toLowerCase();
        boolean number = q.matches("\\d{1,7}");
        List<Summary> found = new ArrayList<>();
        for (Entry entry : entries) {
            if (!types.isEmpty() && !types.contains(entry.transport.getType().name())) {
                continue;
            }
            String object = Objects.toString(entry.transport.getObjectInfo(), "");
            boolean hit = tile != null ? (entry.origin != null && entry.origin.same(tile)) || (entry.destination != null && entry.destination.same(tile))
                : number ? object.matches(".*(^|\\s)" + q + "$")
                : object.toLowerCase().contains(lower) || Objects.toString(entry.transport.getDisplayInfo(), "").toLowerCase().contains(lower);
            if (hit) {
                found.add(new Summary(entry));
                if (found.size() == SEARCH_LIMIT) {
                    break;
                }
            }
        }
        return found;
    }
}

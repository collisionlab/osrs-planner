package shortestpath.workbench;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * The plugin's banks, from its {@code destinations/game_features/bank.tsv}: a row per booth, chest
 * or deposit tile, named by where it is and with what it needs to use. Tiles of one name close
 * together are one bank; names repeat across the map (two banks in Varrock), so a name alone isn't.
 */
public final class BankCatalog {
    static final String RESOURCE = "/destinations/game_features/bank.tsv";
    /** Tiles of one name this close (a side, chained) are one bank. */
    static final int BANK_REACH = 16;
    private static final Pattern TILE = Pattern.compile("^(\\d+) (\\d+) (\\d)$");

    /** What a bank needs: a {@code skill}, a {@code quest}, or a game variable ({@code var}). */
    public static final class Need {
        public final String kind, name;

        Need(String kind, String name) {
            this.kind = kind;
            this.name = name;
        }

        @Override
        public boolean equals(Object other) {
            return other instanceof Need && ((Need) other).kind.equals(kind) && ((Need) other).name.equals(name);
        }

        @Override
        public int hashCode() {
            return Objects.hash(kind, name);
        }
    }

    public static final class Bank {
        /** The name and first tile: stable while the bank's first row is. */
        public final String id, name;
        public final List<TransportCatalog.Point> tiles;
        /** What any of its tiles needs, together. */
        public final List<Need> needs;

        Bank(String id, String name, List<TransportCatalog.Point> tiles, List<Need> needs) {
            this.id = id;
            this.name = name;
            this.tiles = tiles;
            this.needs = needs;
        }
    }

    private static final class Row {
        final TransportCatalog.Point tile;
        final String name;
        final List<Need> needs;

        Row(TransportCatalog.Point tile, String name, List<Need> needs) {
            this.tile = tile;
            this.name = name;
            this.needs = needs;
        }
    }

    private final List<Bank> banks;

    private BankCatalog(List<Bank> banks) {
        this.banks = banks;
    }

    public List<Bank> banks() {
        return banks;
    }

    /** The banks of the plugin on the classpath. */
    public static BankCatalog load() {
        try (InputStream stream = Objects.requireNonNull(BankCatalog.class.getResourceAsStream(RESOURCE), RESOURCE)) {
            return parse(new String(stream.readAllBytes(), StandardCharsets.UTF_8));
        } catch (IOException error) {
            throw new UncheckedIOException(error);
        }
    }

    /** Banks from a bank file's contents: {@code Destination, Info, Skills, Quests, Varbits, VarPlayers}. */
    static BankCatalog parse(String contents) {
        List<Row> rows = new ArrayList<>();
        for (String line : contents.split("\n")) {
            if (line.startsWith("#") || line.isBlank()) {
                continue;
            }
            String[] fields = line.split("\t", -1);
            Matcher tile = TILE.matcher(fields[0].trim());
            if (!tile.matches()) {
                continue;
            }
            List<Need> needs = new ArrayList<>();
            String[] kinds = {null, null, "skill", "quest", "var", "var"};
            for (int i = 2; i < Math.min(fields.length, kinds.length); i++) {
                for (String part : fields[i].split(";")) {
                    if (!part.isBlank()) {
                        needs.add(new Need(kinds[i], part.trim()));
                    }
                }
            }
            rows.add(new Row(new TransportCatalog.Point(Integer.parseInt(tile.group(1)), Integer.parseInt(tile.group(2)),
                Integer.parseInt(tile.group(3))), fields.length > 1 ? fields[1].trim() : "", needs));
        }
        // Chained by name and nearness, in file order.
        int[] group = new int[rows.size()];
        for (int i = 0; i < rows.size(); i++) {
            group[i] = i;
            for (int j = 0; j < i; j++) {
                if (rows.get(j).name.equals(rows.get(i).name) && near(rows.get(j).tile, rows.get(i).tile)) {
                    int from = group[i], to = group[j];
                    for (int k = 0; k <= i; k++) {
                        if (group[k] == from) {
                            group[k] = to;
                        }
                    }
                }
            }
        }
        Map<Integer, List<Row>> groups = new LinkedHashMap<>();
        for (int i = 0; i < rows.size(); i++) {
            groups.computeIfAbsent(group[i], key -> new ArrayList<>()).add(rows.get(i));
        }
        List<Bank> banks = groups.values().stream().map(members -> {
            Row first = members.get(0);
            Set<Need> needs = new LinkedHashSet<>();
            members.forEach(row -> needs.addAll(row.needs));
            String slug = first.name.toLowerCase().replaceAll("[^a-z0-9]+", "-").replaceAll("(^-|-$)", "");
            return new Bank(slug + "@" + first.tile.x + "," + first.tile.y + "," + first.tile.plane, first.name,
                members.stream().map(row -> row.tile).collect(Collectors.toList()), List.copyOf(needs));
        }).collect(Collectors.toList());
        return new BankCatalog(banks);
    }

    private static boolean near(TransportCatalog.Point a, TransportCatalog.Point b) {
        return a.plane == b.plane && Math.abs(a.x - b.x) <= BANK_REACH && Math.abs(a.y - b.y) <= BANK_REACH;
    }
}

# Transport candidates from the BestPath data

These lists compare the transports of the BestPath Data Tool
([rel-osrs/best-path-tool](https://github.com/rel-osrs/best-path-tool)) with this repository's
`src/main/resources/transports/*.tsv` at commit `0fb23cda` (2026-10-24). Nothing in this branch
changes your data files; the lists are here for you to read and take whatever is useful.
Everything in them is offered under this repository's BSD-2-Clause licence.

Each direction of a transport is one row (a two-way transport is two rows, as in your files).

## Where the values come from

- **Tiles and object ids:** the game cache (cache 2735), read by the Data Tool; ladder and stairs
  pairs that the tool found from stacked objects were accepted by hand in the tool's review.
- **Requirements:** OSRS Wiki pages (the page and revision id are in every `Source` cell), the game
  cache, and for quest stages Quest Helper's data (BSD-2-Clause, file named in `Source`).
- **Ticks:** only cited where a Wiki page gives them (spell cast speed, "using the shortcut takes N
  ticks"). The `Ticks (ours, not checked)` column is our own estimate and should not be trusted.
- `Source` = `none recorded` means we have no citation for that row.

Nothing here was re-checked in game for this list, and the matching between the two data sets is
automatic (described below), so please treat every row as a suggestion.

## Files

### Changes to rows you already have

| File | What it lists |
|---|---|
| `1i start or landing not on a floor tile.tsv` | your start or destination tile is not walkable on your `collision-map.zip`; the suggested tile is, on both maps. A no-floor tile that another of your rows continues from (stepping stones, pillars) is left out. the snapping for blocked targets in [PR 846](https://github.com/Skretzo/shortest-path/pull/846) may already cover some of these |
| `1g plane differs.tsv` | the same transport with a start or end on another plane |
| `1a missing requirements.tsv` | a requirement the Wiki gives that your row does not have |
| `1e requirements the format cannot hold.tsv` | the same, but the requirement does not fit the TSV format (partial quest state without a known varbit, house contents, a dialogue choice, a collection log item) |
| `1f start or end 3 or more tiles off.tsv` | the same transport with its start or end 3+ tiles away (teleports 5+) |

Columns: `Their file`, `Their line` (1-based, in your file at `0fb23cda`), `Current row`,
`Suggested row` (both with ` | ` standing for a tab, in that file's column order), `What changes`,
`Also differs` (other differences not applied in the suggested row), `Source`.

### Transports you don't have

| File | What it lists |
|---|---|
| `3b new transports - Wiki or cache source*.tsv` | transports with a Wiki or cache citation (one file each for normal transports, teleports and network stops) |
| `3c new ladders and stairs - from the game cache.tsv` | ladder / stairs / crossing pairs found in the cache from stacked or matching objects; no Wiki page cited |
| `3d new transports - tiles not sourced.tsv` | transports whose tiles have no recorded source (the requirement may still have one) |
| `3e new transports - in copies of other areas*.tsv` | transports inside copies of other areas (quest and cutscene copies such as Isafdar, Tirannwn, Lassar Undercity); may not be wanted at all |

Columns follow your files (`Origin`, `Destination`, `menuOption menuTarget objectID`, `Skills`,
`Items`, `Quests`, `Varbits`, `VarPlayers`, `Duration`, `Display info`; teleports as in
`teleportation_items.tsv`), plus `Needs (not in their format)`, `Ticks (ours, not checked)` and
`Source`. Network stops have `Network`, `Board at` and `Land at` and include the network's shared
requirement (for fairy rings: the quests and the staff).

### Notes on the values

- `Items` uses your item-variations names where ours mean the same group (`AXE`, `SLASH`,
  `CROSSBOW`, `PICKAXE`, `MACHETE`, `GAMES_NECKLACE`). `[name]=1` is one of our item groups with
  no name of yours; its ids are in `item-groups.tsv`.
- `>=` and `<=` were written as `>` one lower and `<` one higher. "Quest done, or the quest varbit
  past a stage" was written as the varbit alone. Spellbooks are written as varbit `4070`.
- `Needs (not in their format)` holds what could not be written in the columns, in plain words
  ("the item must be worn", "needs one of: ...").
- Members-only is not listed.

## How the two data sets were matched

A row of ours matches a row of yours when both ends are on the same plane and within 4 tiles (10
when the object id is the same; on other planes only within 2 tiles and for the same object or the
same plane change). Teleports match on a landing within 8 tiles and the same item, or the same name
and kind (spell / item). Each row of yours is used once. Requirement comparison is approximate (item
groups match when they share an item). Doors were not compared, and quest-instance transports were
left out.

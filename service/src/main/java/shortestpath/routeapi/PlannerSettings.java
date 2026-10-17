package shortestpath.routeapi;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import net.runelite.client.config.ConfigItem;
import net.runelite.client.config.ConfigSection;
import shortestpath.ShortestPathConfig;
import shortestpath.TeleportationItem;
import shortestpath.accounts.Unlock;
import shortestpath.pathfinder.PathfinderBackend;
import shortestpath.profiles.PluginSettings;

/**
 * The plugin settings the web planner can change, as JSON: each is one of the plugin's own config
 * items ({@link ShortestPathConfig}), keyed by its method name, with the plugin's name, description
 * and section. A route request carries only the settings that differ from {@link #defaults()}.
 *
 * <p>Left out: display, colour and hotkey items, which never affect a route; the house items, which
 * come from the account's {@code Poh}; the unlocks the game doesn't report, which are account facts
 * ({@link Unlock.Kind#SETTING}); hidden items (no section); and seasonal transports, which need a
 * league world and league area picks that a planner account does not have.
 *
 * <p>Every setting is put in a {@link Group} here, and the planner shows it by that group. A plugin
 * setting this class doesn't classify stops the catalog from building, so a new plugin option
 * reaches the planner only once someone has decided where it belongs.
 */
public final class PlannerSettings {
    private static final Set<String> NOT_ROUTING_SECTIONS = Set.of("",
        ShortestPathConfig.sectionDisplay, ShortestPathConfig.sectionColours, ShortestPathConfig.sectionHotkeys,
        ShortestPathConfig.sectionPoh);
    private static final Set<String> SEASONAL = Set.of("useSeasonalTransports", "costSeasonalTransports");

    /** Where the planner shows a setting. */
    public enum Group {
        /** Shown above the others: what most routes are planned around. */
        EVERYDAY,
        /** A kind of transport on or off ({@code use…}). */
        TRANSPORT,
        /** Extra tiles a transport must save before it is preferred ({@code cost…}). */
        THRESHOLD,
        /** Search and pathfinder tuning. */
        ADVANCED
    }

    private static final Set<String> EVERYDAY = Set.of("avoidWilderness", "includeBankPath", "useTeleportationItems");
    private static final Set<String> ADVANCED = Set.of("pathfinderBackend", "currencyThreshold",
        "unreachableTargetDistance", "calculationCutoff", "aStarHeuristicWeight", "collisionAwareBlockedTargets");
    /** Plugin settings that are account facts, edited as unlocks. */
    static final Set<String> ACCOUNT = Arrays.stream(Unlock.values()).filter(unlock -> unlock.kind == Unlock.Kind.SETTING)
        .map(unlock -> unlock.setting).collect(Collectors.toUnmodifiableSet());

    /** The group a setting goes in, or an error for one nobody has placed. */
    static Group group(String key, String section, Class<?> type) {
        if (EVERYDAY.contains(key)) {
            return Group.EVERYDAY;
        }
        if (ADVANCED.contains(key)) {
            return Group.ADVANCED;
        }
        if (section.equals("Transport Thresholds") && key.startsWith("cost") && type == int.class) {
            return Group.THRESHOLD;
        }
        if (section.equals("Settings") && key.startsWith("use") && type == boolean.class) {
            return Group.TRANSPORT;
        }
        throw new IllegalStateException("plugin setting " + key + " has no planner group; place it in PlannerSettings "
            + "(or make it an account Unlock)");
    }

    /** One setting as {@code GET /v1/catalog} describes it. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static final class Setting {
        public final String key;
        public final String name;
        public final String description;
        public final String section;
        public final Group group;
        /** {@code boolean}, {@code integer} or {@code choice}. */
        public final String type;
        /** The choices of a {@code choice} setting: enum constant name and the plugin's label. */
        public final List<Catalog.Option> choices;
        public final Object defaultValue;
        final Method setter;
        final Class<?> valueType;

        Setting(String key, String name, String description, String section, Class<?> valueType, Method setter,
                Object defaultValue) {
            this.key = key;
            this.name = name;
            this.group = group(key, section, valueType);
            this.description = description;
            this.section = section;
            this.valueType = valueType;
            this.setter = setter;
            this.defaultValue = defaultValue;
            if (valueType == boolean.class) {
                type = "boolean";
                choices = null;
            } else if (valueType == int.class) {
                type = "integer";
                choices = null;
            } else {
                type = "choice";
                choices = Arrays.stream(valueType.getEnumConstants())
                    .map(value -> new Catalog.Option(((Enum<?>) value).name(), value.toString()))
                    .collect(Collectors.toList());
            }
        }
    }

    private static final Map<String, Setting> SETTINGS = discover();

    private PlannerSettings() { }

    /**
     * The planner's starting settings: the plugin's defaults, with every kind of transport on, the
     * A* backend, every teleport item carried or banked, no fare limit, a 25-second cutoff, and
     * transport requirements never bypassed.
     */
    public static PluginSettings defaults() {
        PluginSettings settings = new PluginSettings();
        settings.setUseGrappleShortcuts(true);
        settings.setUseCanoes(true);
        settings.setUseCharterShips(true);
        settings.setUseHotAirBalloons(true);
        settings.setBypassVarbitChecks(false);
        settings.setBypassVarPlayerChecks(false);
        settings.setUseTeleportationItems(TeleportationItem.INVENTORY_AND_BANK);
        settings.setIncludeBankPath(true);
        settings.setCurrencyThreshold(Integer.MAX_VALUE);
        settings.setCalculationCutoff(25);
        settings.setPathfinderBackend(PathfinderBackend.ASTAR);
        settings.setUseSeasonalTransports(false);
        return settings;
    }

    /** {@link #defaults()} with {@code values} applied; an unknown key or a wrong value is an error. */
    public static PluginSettings fromJson(Map<String, Object> values) {
        PluginSettings settings = defaults();
        if (values == null) {
            return settings;
        }
        for (Map.Entry<String, Object> value : values.entrySet()) {
            Setting setting = SETTINGS.get(value.getKey());
            if (setting == null) {
                throw new IllegalArgumentException("unknown setting: " + value.getKey());
            }
            invoke(setting.setter, settings, convert(setting, value.getValue()));
        }
        return settings;
    }

    /** Every setting the planner can change, in the plugin's section and position order. */
    public static List<Setting> catalog() {
        return List.copyOf(SETTINGS.values());
    }

    private static Object convert(Setting setting, Object value) {
        if (setting.valueType == boolean.class && value instanceof Boolean) {
            return value;
        }
        if (setting.valueType == int.class && value instanceof Integer) {
            return value;
        }
        if (setting.valueType.isEnum() && value instanceof String
                && setting.choices.stream().anyMatch(choice -> choice.id.equals(value))) {
            return enumValue(setting.valueType, (String) value);
        }
        throw new IllegalArgumentException("setting " + setting.key + " must be "
            + (setting.choices == null ? "a" + (setting.type.equals("integer") ? "n integer" : " boolean")
                : "one of " + setting.choices.stream().map(choice -> choice.id).collect(Collectors.toList()))
            + ", not " + value);
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static Object enumValue(Class<?> type, String name) {
        return Enum.valueOf((Class) type, name);
    }

    private static Map<String, Setting> discover() {
        Map<String, Integer> sectionPositions = new LinkedHashMap<>();
        Map<String, String> sectionNames = new LinkedHashMap<>();
        for (Field field : ShortestPathConfig.class.getFields()) {
            ConfigSection section = field.getAnnotation(ConfigSection.class);
            if (section != null) {
                String id = (String) get(field);
                sectionPositions.put(id, section.position());
                sectionNames.put(id, section.name());
            }
        }
        PluginSettings defaults = defaults();
        List<Method> items = new ArrayList<>();
        for (Method method : ShortestPathConfig.class.getMethods()) {
            ConfigItem item = method.getAnnotation(ConfigItem.class);
            Class<?> type = method.getReturnType();
            if (item == null || method.getParameterCount() != 0 || NOT_ROUTING_SECTIONS.contains(item.section())
                || SEASONAL.contains(method.getName()) || ACCOUNT.contains(method.getName())
                || !(type == boolean.class || type == int.class || type.isEnum())) {
                continue;
            }
            items.add(method);
        }
        items.sort(Comparator.comparing((Method method) ->
                sectionPositions.getOrDefault(method.getAnnotation(ConfigItem.class).section(), -1))
            .thenComparing(method -> method.getAnnotation(ConfigItem.class).position()));
        Map<String, Setting> result = new LinkedHashMap<>();
        for (Method method : items) {
            ConfigItem item = method.getAnnotation(ConfigItem.class);
            String key = method.getName();
            Method setter;
            try {
                setter = PluginSettings.class.getMethod("set" + key.substring(0, 1).toUpperCase(Locale.ROOT)
                    + key.substring(1), method.getReturnType());
            } catch (NoSuchMethodException e) {
                // ConfigParityTest requires a setter for every functional item; others are display only.
                continue;
            }
            result.put(key, new Setting(key, item.name(), item.description().replace("<br>", " "),
                sectionNames.getOrDefault(item.section(), ""), method.getReturnType(), setter,
                json(invoke(method, defaults))));
        }
        return result;
    }

    private static Object json(Object value) {
        return value instanceof Enum ? ((Enum<?>) value).name() : value;
    }

    private static Object get(Field field) {
        try {
            return field.get(null);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Object invoke(Method method, Object target, Object... args) {
        try {
            return method.invoke(target, args);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(e);
        } catch (InvocationTargetException e) {
            throw new IllegalStateException(e.getCause());
        }
    }
}

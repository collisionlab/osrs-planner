import { useEffect, useState } from "react";
import type { Setting } from "../../domain/contracts";
import { changeSetting, settingValue, type ChangedSettings } from "../../domain/settings";

/** Shown above the groups: the settings most routes are planned around. */
const everyday = ["avoidWilderness", "includeBankPath", "useTeleportationItems"];

/**
 * Plugin settings that describe the account rather than how to travel: unlocks the game doesn't
 * report (`unlock…`, `respawn…`). The account panel shows them; they stay route settings.
 */
export const isAccountSetting = (setting: Setting) => /^(unlock|respawn)/.test(setting.key);

/**
 * The plugin's travel settings, as the route service's catalog lists them, in three groups:
 * transport toggles (`use…`), transport thresholds, and everything else as advanced. `label`
 * shortens a name where the group title already says it.
 */
function groups(settings: Setting[]): { title: string; note?: string; settings: Setting[]; label?(name: string): string }[] {
  const rest = settings.filter(setting => !everyday.includes(setting.key) && !isAccountSetting(setting));
  const transports = rest.filter(setting => setting.section === "Settings" && setting.type === "boolean" && setting.key.startsWith("use"));
  const thresholds = rest.filter(setting => setting.section === "Transport Thresholds");
  const grouped = new Set([...transports, ...thresholds]);
  return [
    { title: "Transports", settings: transports, label: name => capitalise(name.replace(/^Use /, "")) },
    { title: "Transport thresholds", note: "Extra tiles a transport must save before it is preferred.", settings: thresholds,
      label: name => name.replace(/ threshold$/, "") },
    { title: "Advanced", settings: rest.filter(setting => !grouped.has(setting)) },
  ];
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const MAX_INT = 2_147_483_647;

/** A whole-number input that only reports valid values; the largest int reads as "No limit" and an empty field sets it. */
function NumberField({ setting, value, onChange }: { setting: Setting; value: number; onChange(value: number): void }) {
  const unlimited = setting.defaultValue === MAX_INT;
  const shown = (number: number) => unlimited && number === MAX_INT ? "" : String(number);
  const [text, setText] = useState(shown(value));
  useEffect(() => setText(shown(value)), [value]);
  const parse = (input: string) => unlimited && input === "" ? MAX_INT : /^\d+$/.test(input) && Number(input) <= MAX_INT ? Number(input) : undefined;
  const valid = parse(text) !== undefined;
  return <input type="number" inputMode="numeric" min={0} step={1} aria-label={setting.name} aria-invalid={!valid}
    placeholder={unlimited ? "No limit" : undefined} value={text} onChange={event => {
      setText(event.target.value);
      const next = parse(event.target.value);
      if (next !== undefined) onChange(next);
    }}
    onBlur={() => { if (!valid) setText(shown(value)); }} />;
}

/** Display names for choices whose ids read as jargon. */
const choiceNames: Record<string, Record<string, string>> = {
  pathfinderBackend: { EXACT: "A*", LEGACY: "Legacy" },
};
const settingNames: Record<string, string> = { exactHeuristicWeight: "A* heuristic weight" };

export function SettingField({ setting, changed, label = settingNames[setting.key] || setting.name, onChange }: {
  setting: Setting; changed: ChangedSettings; label?: string; onChange(changed: ChangedSettings): void;
}) {
  const value = settingValue(setting, changed);
  const set = (next: boolean | number | string) => onChange(changeSetting(changed, setting, next));
  const className = setting.key in changed ? "option-row changed" : "option-row";
  const name = <span className="option-name">{label}</span>;
  if (setting.type === "boolean") {
    return <label className={className} title={setting.description}>{name}<input type="checkbox" className="option-switch"
      aria-label={setting.name} checked={value === true} onChange={event => set(event.target.checked)} /></label>;
  }
  if (setting.type === "integer") {
    return <label className={className} title={setting.description}>{name}<NumberField setting={setting} value={value as number} onChange={set} /></label>;
  }
  return <label className={className} title={setting.description}>{name}<select aria-label={setting.name} value={value as string}
    onChange={event => set(event.target.value)}>
    {setting.choices?.map(choice => <option key={choice.id} value={choice.id}>{choiceNames[setting.key]?.[choice.id] || choice.name}</option>)}
  </select></label>;
}

export function RouteSettings({ settings, changed, onChange }: {
  settings: Setting[];
  changed: ChangedSettings;
  onChange(changed: ChangedSettings): void;
}) {
  const pinned = everyday.map(key => settings.find(setting => setting.key === key)).filter((setting): setting is Setting => Boolean(setting));
  return <div className="route-options">
    <div className="option-rows">
      {pinned.map(setting => <SettingField key={setting.key} setting={setting} changed={changed}
      label={setting.key === "useTeleportationItems" ? "Teleport items" : undefined} onChange={onChange} />)}
    </div>
    {groups(settings).filter(group => group.settings.length).map(group => {
      const count = group.settings.filter(setting => setting.key in changed).length;
      return <details className="more-options" key={group.title}>
        <summary><span className="option-group-title">{group.title}</span>
          <span className={count ? "option-count changed" : "option-count"}>{count > 0 ? `${count} changed` : group.settings.length}</span></summary>
        {group.note && <p className="option-note">{group.note}</p>}
        <div className="option-rows">
          {group.settings.map(setting => <SettingField key={setting.key} setting={setting} changed={changed}
            label={group.label?.(setting.name)} onChange={onChange} />)}
        </div>
      </details>;
    })}
    {Object.keys(changed).length > 0 && <button type="button" className="text-button reset-policy"
      onClick={() => onChange({})}>Reset route settings</button>}
  </div>;
}

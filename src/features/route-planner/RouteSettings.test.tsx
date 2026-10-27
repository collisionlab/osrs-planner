import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangedSettings } from "../../domain/settings";
import { catalog } from "../../test/fixtures";
import { RouteSettings } from "./RouteSettings";

afterEach(cleanup);

function renderSettings(changed: ChangedSettings = {}) {
  const onChange = vi.fn<(changed: ChangedSettings) => void>();
  render(<RouteSettings settings={catalog.settings} changed={changed} onChange={onChange} />);
  return onChange;
}

describe("route settings", () => {
  it("records only the settings that differ from the defaults", () => {
    const onChange = renderSettings();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use fairy rings" }));
    expect(onChange).toHaveBeenLastCalledWith({ useFairyRings: false });
    fireEvent.change(screen.getByRole("combobox", { name: /Use teleportation items/ }), { target: { value: "ALL" } });
    expect(onChange).toHaveBeenLastCalledWith({ useTeleportationItems: "ALL" });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Boat threshold" }), { target: { value: "25" } });
    expect(onChange).toHaveBeenLastCalledWith({ costBoats: 25 });
  });

  it("removes a setting set back to its default, and resets them all", () => {
    const onChange = renderSettings({ useFairyRings: false, unlockCanoeAxe: true });
    fireEvent.click(screen.getByRole("checkbox", { name: "Use fairy rings" }));
    expect(onChange).toHaveBeenLastCalledWith({ unlockCanoeAxe: true });
    fireEvent.click(screen.getByRole("button", { name: "Reset route settings" }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("groups the settings and counts the changed ones", () => {
    renderSettings({ currencyThreshold: 1000 });
    expect(screen.getByText("Advanced").parentElement?.textContent).toContain("1 changed");
    // Unlocks the game doesn't report belong to the account panel.
    expect(screen.queryByLabelText("Axe stored at a canoe station")).toBeNull();
  });

  it("ignores invalid numbers", () => {
    const onChange = renderSettings();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Boat threshold" }), { target: { value: "-1" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the largest int as no limit, and an empty field sets it", () => {
    const onChange = renderSettings({ currencyThreshold: 1000 });
    const field = screen.getByRole("spinbutton", { name: "Currency threshold" }) as HTMLInputElement;
    expect(field.value).toBe("1000");
    fireEvent.change(field, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({});
    cleanup(); renderSettings();
    const empty = screen.getByRole("spinbutton", { name: "Currency threshold" }) as HTMLInputElement;
    expect(empty.value).toBe(""); expect(empty.placeholder).toBe("No limit");
  });

  it("omits the retired backend selector", () => {
    renderSettings();
    expect(screen.queryByRole("combobox", { name: "Pathfinder algorithm" })).toBeNull();
  });
});

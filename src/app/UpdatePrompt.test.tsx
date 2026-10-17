import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { UpdatePrompt } from "./UpdatePrompt";

const serve = (release: string) => vi.stubGlobal("fetch", vi.fn(async () =>
  new Response(JSON.stringify({ release }), { headers: { "content-type": "application/json" } })));

const becomeVisible = () => act(async () => { document.dispatchEvent(new Event("visibilitychange")); });

describe("update prompt", () => {
  // jsdom reports "prerender" unless told otherwise.
  beforeAll(() => Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }));
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("stays hidden while the server runs this tab's release", async () => {
    serve("aaa");
    render(<UpdatePrompt />);
    await becomeVisible();
    await becomeVisible();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers a reload once the server runs a newer release", async () => {
    serve("aaa");
    render(<UpdatePrompt />);
    await becomeVisible();
    serve("bbb");
    await becomeVisible();
    expect(await screen.findByRole("button", { name: "Reload" })).toBeTruthy();
  });
});

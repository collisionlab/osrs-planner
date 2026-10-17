import { useEffect, useState } from "react";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// The release this bundle belongs to, set by the release image build. Unset in development, where
// the first /version answer stands in for it.
const BUILT_RELEASE: string | undefined = import.meta.env.VITE_RELEASE || undefined;

async function serverRelease(): Promise<string | undefined> {
  try {
    const response = await fetch("/version", { cache: "no-store" });
    if (!response.ok) return undefined;
    return ((await response.json()) as { release?: string }).release || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Offers a reload once the server runs a different release than this tab's: the frontend and the
 * route service ship together, so an old tab may call an API it no longer matches, and its lazily
 * loaded chunks are gone. Checks on an interval, whenever the tab becomes visible, and when a
 * chunk fails to load.
 */
export function UpdatePrompt() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let mine = BUILT_RELEASE;
    let cancelled = false;
    const check = async () => {
      const release = await serverRelease();
      if (cancelled || !release) return;
      if (!mine) mine = release;
      else if (release !== mine) setStale(true);
    };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    const onChunkError = () => setStale(true);
    void check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("vite:preloadError", onChunkError);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("vite:preloadError", onChunkError);
    };
  }, []);

  if (!stale) return null;
  return <div className="update-prompt" role="status">
    <span>A new version of the planner is available.</span>
    <button type="button" onClick={() => window.location.reload()}>Reload</button>
  </div>;
}

import { useEffect, useState, type FormEvent } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { OpenPullList } from "./OpenPulls";
import { ReviewPage } from "./ReviewPage";
import "./workbench.css";

/**
 * Tools for people working on the plugin's data rather than planning routes, served on
 * `workbench.` hosts. Their URLs mirror GitHub's (swap `github.com` for the workbench host and add
 * `/github`), are not a stable contract, and are kept out of search engines.
 */
export function WorkbenchRoutes() {
  useEffect(() => {
    const robots = document.createElement("meta");
    robots.name = "robots"; robots.content = "noindex, nofollow";
    document.head.append(robots);
    return () => robots.remove();
  }, []);
  return <Routes>
    <Route path="/" element={<WorkbenchHome />} />
    <Route path="/github/:owner/:repo/pull/:number" element={<ReviewPage />} />
    <Route path="/github/:owner/:repo/pull/:number/files" element={<ReviewPage />} />
    <Route path="/github/:owner/:repo/pull/:number/files/:range" element={<ReviewPage />} />
    <Route path="/github/:owner/:repo/compare/*" element={<ReviewPage />} />
    <Route path="*" element={<WorkbenchHome missing />} />
  </Routes>;
}

/** A GitHub pull request or compare URL as its workbench path, or nothing. */
export function workbenchPath(input: string): string | undefined {
  const match = /^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)\/(pull\/\d+(?:\/files\/[0-9a-f]{40}\.\.[0-9a-f]{40})?|compare\/[^#?]+)/.exec(input.trim());
  return match ? `/github/${match[1]}/${match[2]}/${match[3]}` : undefined;
}

function WorkbenchHome({ missing }: { missing?: boolean }) {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [error, setError] = useState(missing ? "No workbench tool at this address." : "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const path = workbenchPath(url);
    if (path) navigate(path); else setError("Paste a github.com pull request or compare URL.");
  };
  return <div className="wb-page">
    <header className="wb-header"><span className="wb-brand">Workbench</span><span className="wb-tool">Tools for the plugin's data</span></header>
    <main className="wb-home">
      <h1>Transport review</h1>
      <p>See a pull request's transport and destination rows on the map: each change, the areas it connects, and the tiles the pathfinder can and can't walk.</p>
      <form onSubmit={submit}>
        <input aria-label="GitHub URL" placeholder="https://github.com/Skretzo/shortest-path/pull/844" value={url} onChange={event => setUrl(event.target.value)} />
        <button type="submit">Review</button>
      </form>
      <p className="wb-hint">Or swap the host in any GitHub URL: <code>github.com/…/pull/844</code> → <code>{window.location.host}/github/…/pull/844</code>. Branches without a pull request work too, as <code>…/compare/master...my-branch</code>.</p>
      {error && <p role="alert">{error}</p>}
      <OpenPullList />
    </main>
  </div>;
}

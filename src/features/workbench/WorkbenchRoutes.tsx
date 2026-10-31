import { useEffect, useState, type FormEvent } from "react";
import { Link, Route, Routes, useNavigate } from "react-router-dom";
import { OpenPullList } from "./OpenPulls";
import { ReviewPage } from "./ReviewPage";
import { TransportExplorer } from "./TransportExplorer";
import { CandidatesPage } from "./CandidatesPage";
import { BenchmarksPage } from "./BenchmarksPage";
import { InsetInvestigation } from "./investigation/InsetInvestigation";
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
    <Route path="/transports" element={<TransportExplorer />} />
    <Route path="/candidates" element={<CandidatesPage />} />
    <Route path="/insets" element={<InsetInvestigation />} />
    <Route path="/benchmarks" element={<BenchmarksPage />} />
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
      {error && <p role="alert">{error}</p>}
      <nav className="wb-tools" aria-label="Tools">
        <Link to="/candidates" aria-label="Transport candidates"><b>Transport candidates</b><span>Review proposed transport corrections against bundled data, map tiles and collision.</span></Link>
        <Link to="/transports"><b>Transport explorer</b><span>Every transport on the map: where it goes, what it needs, and its row.</span></Link>
        <Link to="/benchmarks"><b>Benchmarks</b><span>Every benchmark case in shortest-path-tooling: where they start and end, and each one run on the engine.</span></Link>
        <Link to="/insets"><b>Inset investigation</b><span>Areas off the main map: their entrances, connections and names.</span></Link>
        <a href="#review"><b>Pull request review</b><span>A pull request's transport changes on the map.</span></a>
      </nav>
      <section id="review" aria-label="Pull request review">
        <h2>Review a pull request</h2>
        <form onSubmit={submit}>
          <input aria-label="GitHub URL" placeholder="https://github.com/Skretzo/shortest-path/pull/844" value={url} onChange={event => setUrl(event.target.value)}
            title={`Or swap the host in any GitHub URL: ${window.location.host}/github/…/pull/844, or …/compare/master...my-branch`} />
          <button type="submit">Review</button>
        </form>
        <OpenPullList />
      </section>
    </main>
  </div>;
}

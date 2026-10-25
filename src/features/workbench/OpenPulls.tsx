import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loadOpenPulls, openPullPath, type OpenPulls } from "./api";

/** Shown before "All". */
const SHOWN = 6;

/** The repository the workbench lists open pull requests of (the service's default). */
export const LISTED = { owner: "Skretzo", repo: "shortest-path" };

/** The open pull requests that change transports, as the service last listed them, or an error. */
export function useOpenPulls(owner: string, repo: string) {
  const [list, setList] = useState<OpenPulls>();
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setList(undefined); setError("");
    loadOpenPulls(owner, repo, abort.signal).then(setList,
      reason => { if (!abort.signal.aborted) setError(String(reason instanceof Error ? reason.message : reason)); });
    return () => abort.abort();
  }, [owner, repo]);
  return { list, error };
}

function ago(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

/** The home page's list: each open pull request that changes transports, linked to its review. */
export function OpenPullList() {
  const { list, error } = useOpenPulls(LISTED.owner, LISTED.repo);
  const [all, setAll] = useState(false);
  const shown = all ? list?.pulls : list?.pulls.slice(0, SHOWN);
  return <section className="wb-open" aria-label="Open pull requests">
    <h3>Open pull requests that change transports</h3>
    {error ? <p className="wb-hint">The list is unavailable: {error}</p>
      : !list ? <p className="wb-hint" role="status">Loading the list…</p>
      : !list.refreshedAt ? <p className="wb-hint" role="status">The service is reading the pull requests; try again in a minute.</p>
      : !list.pulls.length ? <p className="wb-hint">None right now.</p>
      : <ul>{shown!.map(pull => <li key={pull.number}>
        <Link to={openPullPath(list.repository, pull)}>
          <span className="wb-open-number">#{pull.number}</span>
          <span className="wb-open-title">{pull.title}</span>
          {pull.draft && <span className="wb-draft">draft</span>}
          <span className="wb-open-meta">{pull.author} · {pull.units} {pull.units === 1 ? "change" : "changes"} · <span className="added">+{pull.counts.added}</span> <span className="removed">−{pull.counts.removed}</span> <span className="changed">~{pull.counts.changed}</span></span>
        </Link>
      </li>)}</ul>}
    {list && list.pulls.length > SHOWN && !all && <button type="button" className="wb-more" onClick={() => setAll(true)}>All {list.pulls.length}</button>}
    {list?.refreshedAt && <p className="wb-hint">Listed {ago(list.refreshedAt)}.</p>}
  </section>;
}

/** A menu in a review's header for moving to another open pull request of the same repository. */
export function OpenPullPicker({ owner, repo, current }: { owner: string; repo: string; current?: number }) {
  const navigate = useNavigate();
  const { list } = useOpenPulls(owner, repo);
  if (!list?.pulls.length) return null;
  const listed = list.pulls.some(pull => pull.number === current);
  return <select className="wb-picker" aria-label="Open pull requests" value={listed ? String(current) : ""}
    onChange={event => {
      const pull = list.pulls.find(other => String(other.number) === event.target.value);
      if (pull) navigate(openPullPath(list.repository, pull));
    }}>
    {!listed && <option value="">Open pull requests…</option>}
    {list.pulls.map(pull => <option key={pull.number} value={pull.number}>#{pull.number} {pull.title}{pull.draft ? " (draft)" : ""}</option>)}
  </select>;
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageTitle } from "../components/ui";
import type { Branch, CheckpointSummary } from "../domain/workspace";
import { workspaceRequest } from "../platform/workspace";

type WorkspaceSummary = {
  canManage: boolean;
  checkpoints: CheckpointSummary[];
  branches: Branch[];
  runs: Array<{ id: string; createdAt: string }>;
  proposals: Array<{ id: string; name: string; createdAt: string }>;
  publications: Array<{ id: string; approvedAt: string }>;
};
type HistoryPage = {
  checkpoints: CheckpointSummary[];
  next: { at: string; id: string } | null;
};
type TrackingStatus = {
  enabled: boolean;
  phase?: "issues" | "pages" | "linked";
  lastSuccessfulSync?: string;
  lastError?: string;
};

function TrackingControls({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState<TrackingStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setStatus(await workspaceRequest<TrackingStatus>("trackingStatus"));
  }
  useEffect(() => {
    void refresh().catch(() => setError("Could not load tracking status."));
  }, []);
  async function act(action: string) {
    setBusy(true);
    setError("");
    try {
      await workspaceRequest(action);
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not update tracking.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card padded-card workspace-card">
      <h2>Automatic tracking</h2>
      <p>
        Track this project's Jira tasks and pages in its matching Confluence
        space. Saved versions remain available after tracking is stopped. Each
        automatic capture contains one source.
      </p>
      {!status ? (
        <p role="status">Loading tracking status…</p>
      ) : (
        <>
          <p>
            <strong>Status:</strong>{" "}
            {status.enabled
              ? status.lastError
                ? "Needs attention"
                : "On"
              : "Off"}
          </p>
          {status.enabled && (
            <p>
              {status.lastSuccessfulSync
                ? `Last complete synchronization: ${new Date(status.lastSuccessfulSync).toLocaleString()}.`
                : "Initial synchronization is still in progress."}{" "}
              Current step:{" "}
              {status.phase === "issues"
                ? "Jira tasks"
                : status.phase === "pages"
                  ? "Confluence pages"
                  : "additional selected pages"}
              .
            </p>
          )}
          {status.lastError && (
            <p role="alert" className="live-error">
              {status.lastError}
            </p>
          )}
          {canManage &&
            (status.enabled ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act("retryTracking")}
                >
                  Check for changes
                </button>{" "}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act("disableTracking")}
                >
                  Stop tracking
                </button>{" "}
                {status.lastError && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act("enableTracking")}
                  >
                    Restart tracking with my account
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act("enableTracking")}
              >
                Turn on tracking
              </button>
            ))}
          {!canManage && (
            <p>A project administrator can change tracking settings.</p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
    </section>
  );
}
export type ProjectSection =
  "history" | "project-branches" | "agents" | "project-reviews" | "settings";

function recordLink(kind: string, id: string) {
  return (
    "/jira?view=workspace&record=" +
    encodeURIComponent(kind) +
    "&id=" +
    encodeURIComponent(id)
  );
}

export function ProjectSections({ section }: { section: ProjectSection }) {
  const [workspace, setWorkspace] = useState<WorkspaceSummary>();
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryPage>();
  const [historyError, setHistoryError] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  useEffect(() => {
    let active = true;
    setError("");
    workspaceRequest<WorkspaceSummary>("load").then(
      (value) => {
        if (active) setWorkspace(value);
      },
      (reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load this project.",
          );
      },
    );
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (section !== "history") return;
    let active = true;
    setHistory(undefined);
    setHistoryError("");
    workspaceRequest<HistoryPage>("checkpointHistory").then(
      (page) => {
        if (active) setHistory(page);
      },
      (reason: unknown) => {
        if (active)
          setHistoryError(
            reason instanceof Error
              ? reason.message
              : "Could not load history.",
          );
      },
    );
    return () => {
      active = false;
    };
  }, [section]);

  async function loadMoreHistory() {
    if (!history?.next || loadingHistory) return;
    setLoadingHistory(true);
    setHistoryError("");
    try {
      const page = await workspaceRequest<HistoryPage>("checkpointHistory", {
        cursor: history.next,
      });
      setHistory({
        checkpoints: [...history.checkpoints, ...page.checkpoints],
        next: page.next,
      });
    } catch (reason) {
      setHistoryError(
        reason instanceof Error
          ? reason.message
          : "Could not load older project states.",
      );
    } finally {
      setLoadingHistory(false);
    }
  }
  if (error)
    return (
      <p role="alert" className="live-error">
        {error}
      </p>
    );
  if (!workspace) return <p role="status">Loading project…</p>;

  if (section === "history")
    return (
      <>
        <PageTitle
          title="History"
          description="Open a saved project state to compare sources or create a branch."
        />
        <section className="card padded-card workspace-card">
          <h2>Project states</h2>
          {historyError && (
            <p role="alert" className="live-error">
              {historyError}
            </p>
          )}
          {!history && historyError ? null : !history ? (
            <p role="status">Loading history…</p>
          ) : history?.checkpoints.length ? (
            <ul className="workspace-records">
              {history.checkpoints.map((entry) => (
                <li key={entry.id}>
                  <Link to={recordLink("checkpoint", entry.id)}>
                    {entry.name}
                  </Link>
                  <small>
                    {entry.finishedAt
                      ? new Date(entry.finishedAt).toLocaleString()
                      : "Capture pending"}{" "}
                    · {entry.sourceCount} sources
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No project states have been saved yet. Choose project sources to
              capture the first one.
            </p>
          )}
          {history?.next && (
            <button
              type="button"
              className="button button-secondary button-normal"
              onClick={() => void loadMoreHistory()}
              disabled={loadingHistory}
            >
              {loadingHistory ? "Loading…" : "Load older states"}
            </button>
          )}
          <Link className="text-link" to="/jira?view=workspace">
            Manage project sources and checkpoints
          </Link>
        </section>
        <section className="card padded-card workspace-card">
          <h2>Recorded decisions</h2>
          <Link className="text-link" to="/jira?view=decisions">
            Find a past decision
          </Link>
        </section>
      </>
    );

  if (section === "project-branches")
    return (
      <>
        <PageTitle
          title="Branches"
          description="Explore alternative changes before sending them for review."
        />
        <section className="card padded-card workspace-card">
          <h2>Project branches</h2>
          {workspace.branches.length ? (
            <ul className="workspace-records">
              {workspace.branches.map((branch) => (
                <li key={branch.id}>
                  <Link to={recordLink("branch", branch.id)}>
                    {branch.name}
                  </Link>
                  <small>
                    Created {new Date(branch.createdAt).toLocaleString()}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No branches yet. Open a project state in History to create one.
            </p>
          )}
          <Link className="text-link" to="/jira?view=history">
            Open project history
          </Link>
        </section>
      </>
    );

  if (section === "agents")
    return (
      <>
        <PageTitle
          title="Agents"
          description="Prepare project context for an agent and review submitted work."
        />
        <section className="card padded-card workspace-card">
          <h2>Start from a branch</h2>
          <p>
            Open a branch to prepare a Codex run with its saved sources and your
            objective.
          </p>
          <Link className="text-link" to="/jira?view=project-branches">
            Open branches
          </Link>
        </section>
        <section className="card padded-card workspace-card">
          <h2>Recorded sessions</h2>
          {workspace.runs.length ? (
            <ul className="workspace-records">
              {workspace.runs.map((run) => (
                <li key={run.id}>
                  <Link to={recordLink("session", run.id)}>
                    Session · {new Date(run.createdAt).toLocaleString()}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>No sessions recorded yet.</p>
          )}
          <p>
            Codex and Copilot connect through Atlassian MCP. Rovo can read saved
            Kinlet decisions. Connection status is managed in each client.
          </p>
        </section>
      </>
    );

  if (section === "project-reviews")
    return (
      <>
        <PageTitle
          title="Reviews"
          description="Review submitted changes and decisions that need attention."
        />
        <section className="card padded-card workspace-card">
          <h2>Submitted proposals</h2>
          {workspace.proposals.length ? (
            <ul className="workspace-records">
              {workspace.proposals.map((proposal) => (
                <li key={proposal.id}>
                  <Link to={recordLink("proposal", proposal.id)}>
                    {proposal.name}
                  </Link>
                  <small>{new Date(proposal.createdAt).toLocaleString()}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>No submitted proposals yet.</p>
          )}
          <Link className="text-link" to="/jira?view=attention">
            Review priorities
          </Link>
        </section>
        <section className="card padded-card workspace-card">
          <h2>Publication history</h2>
          {workspace.publications.length ? (
            <ul className="workspace-records">
              {workspace.publications.map((entry) => (
                <li key={entry.id}>
                  <Link to={recordLink("publication", entry.id)}>
                    Publication · {new Date(entry.approvedAt).toLocaleString()}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>No approved project publications yet.</p>
          )}
        </section>
      </>
    );

  return (
    <>
      <PageTitle
        title="Settings"
        description="Manage project sources, review templates and session retention."
      />
      <TrackingControls canManage={workspace.canManage} />
      <section className="card padded-card workspace-card">
        <h2>Project workspace</h2>
        <p>
          {workspace.canManage
            ? "Choose sources and review settings for this project."
            : "A project administrator can manage sources and review settings."}
        </p>
        <Link className="text-link" to="/jira?view=workspace">
          Open workspace settings
        </Link>
      </section>
    </>
  );
}

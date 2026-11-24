import { downloadJson } from "../platform/download";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Download,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  History as HistoryIcon,
  Layers,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApp } from "../app-context";
import {
  ArtifactIcon,
  Avatar,
  Badge,
  Button,
  EmptyState,
  Notice,
  PageTitle,
  SectionHeading,
  Tabs,
} from "../components/ui";
import { formatDate } from "../domain/model";

export function History() {
  const { state, open } = useApp();
  const navigate = useNavigate();
  const [view, setView] = useState("timeline");
  const [query, setQuery] = useState("");
  const checkpoints = [...state.checkpoints]
    .reverse()
    .filter((c) =>
      `${c.id} ${c.title} ${c.author}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  return (
    <div className="page">
      <PageTitle
        title="Project history"
        description="Inspect saved project states or create a branch from a checkpoint."
        actions={
          <Button variant="primary" onClick={() => open({ type: "capture" })}>
            <Plus size={15} />
            Save checkpoint
          </Button>
        }
      />
      <div className="card history-card">
        <div className="table-toolbar">
          <Tabs
            items={[
              { id: "timeline", label: "Branch timeline" },
              {
                id: "list",
                label: "Checkpoint list",
                count: state.checkpoints.length,
              },
            ]}
            value={view}
            onChange={setView}
          />

        </div>
        {view === "timeline" ? (
          <BranchTimeline />
        ) : (
          <div className="history-intro">
            <HistoryIcon size={19} />
            <p>
              Every saved checkpoint is a separate sample state. Open one
              without changing your project.
            </p>
          </div>
        )}
        <div className="history-legend">
          <span>
            <i className="tiny-dot blue" />
            Observed Main
          </span>
          <span>
            <i className="tiny-dot violet" />
            Branch alternatives
          </span>
          <span>
            <ShieldCheck size={12} />
            Accepted baseline {state.approvedId}
          </span>
        </div>
      </div>
      <SectionHeading
        title="Saved checkpoints"
        action={
          <div className="inline-search">
            <Search size={14} />
            <input
              aria-label="Search checkpoints"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a checkpoint…"
            />
          </div>
        }
      />
      <div className="card checkpoint-list">
        {checkpoints.map((c) => (
          <button
            key={c.id}
            className="checkpoint-row"
            onClick={() => navigate(`/checkpoints/${c.id}`)}
          >
            <span
              className={`checkpoint-icon ${c.kind === "publication" ? "green" : ""}`}
            >
              {c.kind === "publication" ? (
                <GitMerge size={18} />
              ) : (
                <GitCommitHorizontal size={19} />
              )}
            </span>
            <div className="checkpoint-row-title">
              <div>
                <Badge tone={c.id === state.approvedId ? "blue" : "neutral"}>
                  {c.id}
                </Badge>
                <strong>{c.title}</strong>
                {c.id === state.observedId ? (
                  <Badge tone="green">Main</Badge>
                ) : null}
              </div>
              <p>{c.description}</p>
            </div>
            <div className="checkpoint-row-meta">
              <span>{c.author}</span>
              <small>
                {formatDate(c.createdAt)} · {Object.keys(c.artifacts).length}{" "}
                sources
              </small>
            </div>
            <ChevronRight size={16} />
          </button>
        ))}
        {!checkpoints.length ? (
          <EmptyState
            title="No matching checkpoints"
            description="Try another title, checkpoint ID, or author."
          />
        ) : null}
      </div>
      <div className="history-note">
        <ShieldCheck size={15} />
        <p>
          To edit a saved version, open its checkpoint and create a branch.
        </p>
      </div>
    </div>
  );
}
export function BranchTimeline() {
  const { state } = useApp();
  const navigate = useNavigate();
  const main = state.checkpoints.filter((c) => c.kind !== "commit").slice(-5);
  const positions = new Map(main.map((c, i) => [c.id, 90 + i * 165]));
  const width = Math.max(750, main.length * 165 + 140);
  const branches = state.branches
    .filter((b) => b.status !== "archived")
    .slice(0, 3);
  const height = 100 + branches.length * 72;
  return (
    <div className="timeline-scroll">
      <div className="branch-timeline" style={{ minWidth: width, height }}>
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <pattern
              id="graphgrid"
              width="22"
              height="22"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r=".7" fill="currentColor" />
            </pattern>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="url(#graphgrid)"
            className="graph-grid"
          />
          <path
            d={`M70 48 H${width - 70}`}
            stroke="#aebff5"
            strokeWidth="2"
            fill="none"
          />
          {branches.map((b, i) => {
            const x = positions.get(b.baseId) || 90;
            const y = 120 + i * 72;
            return (
              <path
                key={b.id}
                d={`M${x} 48 C${x + 40} 48 ${x + 35} ${y} ${x + 90} ${y} H${width - 75}`}
                stroke={
                  b.color === "teal"
                    ? "#57bda5"
                    : b.color === "blue"
                      ? "#7798f6"
                      : "#b39ae6"
                }
                strokeWidth="2"
                fill="none"
              />
            );
          })}
        </svg>
        <span className="timeline-lane main-lane">MAIN</span>
        {main.map((c, i) => (
          <button
            key={c.id}
            className={`timeline-node ${c.id === state.approvedId ? "baseline-node" : ""}`}
            style={{ left: 90 + i * 165, top: 48 }}
            onClick={() => navigate(`/checkpoints/${c.id}`)}
            aria-label={`Inspect checkpoint ${c.id}`}
          >
            <span className="node-dot">
              {c.id === state.approvedId ? <Check size={10} /> : null}
            </span>
            <strong>{c.id}</strong>
            <small>
              {c.kind === "publication"
                ? "Published"
                : c.id === state.approvedId
                  ? "Accepted baseline"
                  : "Source observed"}
            </small>
          </button>
        ))}
        {branches.map((b, i) => (
          <button
            key={b.id}
            className={`timeline-branch-node tone-${b.color}`}
            style={{
              left: Math.max(270, (positions.get(b.baseId) || 90) + 150),
              top: 120 + i * 72,
            }}
            onClick={() => navigate(`/branches/${b.id}`)}
          >
            <span className="branch-node-circle">
              <GitBranch size={13} />
            </span>
            <span>
              <strong>{b.name}</strong>
              <small>
                {b.status === "published"
                  ? "Published changes"
                  : `Saved draft ${b.revision}`}{" "}
                · {b.owner}
              </small>
            </span>
            <ChevronRight size={13} />
          </button>
        ))}
      </div>
    </div>
  );
}
export function CheckpointDetail() {
  const { id } = useParams();
  const { state, open } = useApp();
  const [tab, setTab] = useState("state");
  const c = state.checkpoints.find((c) => c.id === id);
  const parent = state.checkpoints.find((p) => p.id === c?.parentId);
  if (!c)
    return (
      <div className="page">
        <EmptyState
          title="Checkpoint not found"
          description="Open History to choose an available saved state."
          action={
            <Link className="button button-primary" to="/history">
              Open history
            </Link>
          }
        />
      </div>
    );
  const changed = Object.values(c.artifacts).filter(
    (a) => JSON.stringify(a) !== JSON.stringify(parent?.artifacts[a.id]),
  );
  return (
    <div className="page">
      <Link className="back-link" to="/history">
        <ArrowLeft size={14} />
        Back to history
      </Link>
      <PageTitle
        eyebrow={`SAVED CHECKPOINT · ${c.id}`}
        title={c.title}
        description={c.description}
        actions={
          <>
            <Button
              onClick={() =>
                downloadJson(`checkpoint-${c.id}.json`, {
                  prototype: true,
                  checkpoint: c,
                })
              }
            >
              <Download size={14} />
              Export
            </Button>
            <Button
              variant="primary"
              onClick={() => open({ type: "branch", checkpointId: c.id })}
            >
              <GitBranch size={14} />
              Branch from here
            </Button>
          </>
        }
      />
      <Notice>
        Viewing {c.id}, saved{" "}
        {formatDate(c.createdAt, {
          month: "long",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
        . Current sample Main is {state.observedId}.
      </Notice>
      <div className="checkpoint-detail-meta">
        <span>
          <Avatar name={c.author} size="small" />
          {c.author}
        </span>
        <span>
          <Layers size={14} />
          {Object.keys(c.artifacts).length} captured sources
        </span>
        <Badge tone={c.id === state.approvedId ? "blue" : "green"}>
          {c.id === state.approvedId ? "Accepted baseline" : "Saved state"}
        </Badge>
        <span>
          Parent:{" "}
          {c.parentId ? (
            <Link to={`/checkpoints/${c.parentId}`}>{c.parentId}</Link>
          ) : (
            "First checkpoint"
          )}
        </span>
      </div>
      <div className="card">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: "state", label: "Project state" },
            {
              id: "changes",
              label: "Changes",
              count: parent ? changed.length : 0,
            },
            { id: "context", label: "Context & sessions" },
            { id: "activity", label: "Activity" },
          ]}
        />
        <div className="padded-card">
          {tab === "state" ? (
            <div className="artifact-detail-list">
              {Object.values(c.artifacts).map((a) => (
                <button
                  key={a.id}
                  className="source-detail-row"
                  onClick={() =>
                    open({
                      type: "evidence",
                      artifactId: a.id,
                      checkpointId: c.id,
                    })
                  }
                >
                  <ArtifactIcon artifact={a} />
                  <div>
                    <strong>
                      {state.flags.accessLost && a.id === "policy"
                        ? "Unavailable source"
                        : a.title}
                    </strong>
                    <span>
                      {a.key} · captured v{a.version}
                    </span>
                  </div>
                  <Badge>{a.status}</Badge>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          ) : tab === "changes" ? (
            parent ? (
              <div className="checkpoint-diffs">
                {changed.map((a) => (
                  <div className="checkpoint-diff" key={a.id}>
                    <div className="row-heading">
                      <ArtifactIcon artifact={a} />
                      <strong>{a.key}</strong>
                      <Badge tone="blue">Changed</Badge>
                    </div>
                    <div className="two-column diff-columns">
                      <div className="diff-old">
                        <small>{parent.id} · BEFORE</small>
                        <p>
                          {parent.artifacts[a.id]?.description ||
                            "Not captured"}
                        </p>
                      </div>
                      <div className="diff-new">
                        <small>{c.id} · AFTER</small>
                        <p>{a.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Source checkpoint"
                description="This is the first captured sample baseline. There is no earlier checkpoint to compare."
              />
            )
          ) : tab === "context" ? (
            <div className="artifact-detail-list">
              {state.runs.filter((r) => r.checkpointId === c.id).length ? (
                state.runs
                  .filter((r) => r.checkpointId === c.id)
                  .map((r) => (
                    <Link
                      className="source-detail-row"
                      key={r.id}
                      to={`/sessions/${r.id}`}
                    >
                      <Sparkles size={18} />
                      <div>
                        <strong>{r.title}</strong>
                        <span>
                          {r.provider} · context from {c.id}
                        </span>
                      </div>
                      <ChevronRight size={15} />
                    </Link>
                  ))
              ) : (
                <EmptyState
                  title="No sessions linked yet"
                  description="Create a branch from this checkpoint and prepare context to start a recorded sample session."
                  icon="branch"
                />
              )}
            </div>
          ) : (
            <div className="checkpoint-activity">
              <span className="activity-dot blue" />
              <div>
                <strong>
                  {c.kind === "publication"
                    ? "Reviewed sample changes published"
                    : "Checkpoint saved"}
                </strong>
                <p>
                  {c.author} · {formatDate(c.createdAt)}
                </p>
                <p>
                  {Object.keys(c.artifacts).length} source versions saved.
                  Local sample data only.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

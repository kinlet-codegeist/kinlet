import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  Download,
  FileText,
  GitBranch,
  Layers,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp } from "../app-context";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Notice,
  PageTitle,
  ProviderIcon,
  SectionHeading,
  Tabs,
} from "../components/ui";
import { downloadJson } from "../platform/download";

export function Sessions() {
  const { state } = useApp();
  const [filter, setFilter] = useState("all");
  const runs = state.runs.filter(
    (r) => filter === "all" || r.provider.toLowerCase() === filter,
  );
  return (
    <div className="page">
      <PageTitle
        title="Agent sessions"
        description="Inspect the inputs, activity, and proposals from sample agent sessions."
        actions={
          <Link className="button button-primary" to="/branches">
            <Sparkles size={15} />
            Prepare a new session
          </Link>
        }
      />
      <div className="listing-toolbar">
        <Tabs
          items={[
            { id: "all", label: "All sessions", count: state.runs.length },
            { id: "codex", label: "Codex" },
            { id: "claude", label: "Claude" },
            { id: "rovo", label: "Rovo" },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>
      <div className="session-grid">
        {runs.map((run) => {
          const branch = state.branches.find((b) => b.id === run.branchId);
          return (
            <Link
              className="card session-card"
              key={run.id}
              to={`/sessions/${run.id}`}
            >
              <div className="session-card-top">
                <ProviderIcon provider={run.provider} size={40} />
                <span>
                  <strong>{run.provider}</strong>
                  <small>Sample session</small>
                </span>
                <Badge
                  tone={
                    run.status === "waiting"
                      ? "amber"
                      : run.status === "finished"
                        ? "green"
                        : "blue"
                  }
                >
                  {run.status === "waiting"
                    ? "Needs your input"
                    : run.status === "finished"
                      ? "Reviewed"
                      : "Ready for review"}
                </Badge>
              </div>
              <h2>{run.title}</h2>
              <div className="session-branch">
                <GitBranch size={14} />
                {branch?.name}
              </div>
              <div className="session-card-inputs">
                <div>
                  <span>Starting checkpoint</span>
                  <strong>{run.checkpointId}</strong>
                </div>
                <div>
                  <span>Recorded activity</span>
                  <strong>{run.events.length} events</strong>
                </div>
              </div>
              <div className="session-card-footer">
                <span>
                  <ShieldCheck size={13} />
                  App inputs & tool activity
                </span>
                <ArrowRight size={16} />
              </div>
            </Link>
          );
        })}
        {!runs.length ? (
          <div className="card span-all">
            <EmptyState
              title="No recorded sessions"
              description="Prepare context on a branch to try a new sample session."
              icon="branch"
              action={
                <Link to="/branches" className="button button-primary">
                  Explore branches
                  <ArrowRight size={14} />
                </Link>
              }
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
export function SessionDetail() {
  const { id } = useParams();
  const { state, act, open } = useApp();
  const [tab, setTab] = useState("activity");
  const [handoff, setHandoff] = useState(false);
  const [closing, setClosing] = useState(false);
  const run = state.runs.find((r) => r.id === id);
  if (!run)
    return (
      <div className="page">
        <EmptyState
          title="Session not found"
          description="Choose an available recorded sample session."
          action={
            <Link className="button button-primary" to="/sessions">
              Open sessions
            </Link>
          }
        />
      </div>
    );
  const branch = state.branches.find((b) => b.id === run.branchId);
  const context = state.contexts.find((c) => c.id === run.contextId);
  const proposal = state.proposals.find((p) => p.runId === run.id);
  const questions = state.questions.filter((q) => q.runId === run.id);
  return (
    <div className="page">
      <Link className="back-link" to="/sessions">
        <ArrowLeft size={14} />
        All agent sessions
      </Link>
      <PageTitle
        eyebrow={`${run.provider.toUpperCase()} · RECORDED SAMPLE SESSION`}
        title={run.title}
        description={
          <>View supplied context, recorded events, and proposed changes.</>
        }
        actions={
          <>
            <Button onClick={() => setHandoff(!handoff)}>
              <Sparkles size={14} />
              Prepare handoff
            </Button>
            {proposal ? (
              <Link
                className="button button-primary"
                to={`/reviews/${proposal.id}`}
              >
                Open proposal
                <ArrowRight size={14} />
              </Link>
            ) : null}
          </>
        }
      />
      <div className="run-detail-header card">
        <ProviderIcon provider={run.provider} size={44} />
        <div>
          <strong>{run.provider}</strong>
          <p>
            {branch?.name} · started from {run.checkpointId}
          </p>
        </div>
        <Badge
          tone={
            run.status === "waiting"
              ? "amber"
              : run.status === "finished"
                ? "green"
                : "blue"
          }
        >
          {run.status === "waiting"
            ? "Waiting for your decision"
            : run.status === "finished"
              ? "Finished"
              : "Proposal / decision recorded"}
        </Badge>
        <Badge>MCP-only sample capture</Badge>
      </div>
      {run.checkpointId !== state.observedId ? (
        <Notice
          tone="warning"
          action={
            <Link className="text-link" to={`/checkpoints/${run.checkpointId}`}>
              Inspect starting point
              <ArrowRight size={12} />
            </Link>
          }
        >
          Main has advanced since this session’s starting checkpoint. Its
          original inputs remain unchanged.
        </Notice>
      ) : null}
      {handoff ? (
        <div className="card padded-card handoff-card">
          <SectionHeading
            title="Session summary"
            action={
              <Button
                size="small"
                onClick={() =>
                  downloadJson(`handoff-${run.id}.json`, {
                    prototype: true,
                    objective: run.title,
                    checkpoint: run.checkpointId,
                    branch: branch?.name,
                    context,
                    events: run.events,
                    questions,
                  })
                }
              >
                <Download size={13} />
                Export handoff
              </Button>
            }
          />
          <p>
            <strong>Objective:</strong> {run.title}
          </p>
          <p>
            <strong>Recorded work:</strong>{" "}
            {run.events.map((e) => e.title).join(" → ")}.
          </p>
          <p>
            <strong>Open questions:</strong>{" "}
            {questions
              .filter((q) => !q.answer)
              .map((q) => q.title)
              .join("; ") || "No unanswered recorded questions."}
          </p>
          <p>
            <strong>Before continuing:</strong> review the latest source changes
            and prepare a fresh context pack if relevant.
          </p>
          <Badge tone="violet">
            Structured sample handoff · not internal model state
          </Badge>
        </div>
      ) : null}
      <div className="session-detail-layout">
        <div className="card">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { id: "activity", label: "Activity", count: run.events.length },
              { id: "context", label: "Context supplied" },
              { id: "coverage", label: "What is saved" },
            ]}
          />
          <div className="padded-card">
            {tab === "activity" ? (
              <div className="run-events">
                {run.events.map((event, i) => (
                  <div className="run-event" key={`${i}-${event.title}`}>
                    <span
                      className={`run-event-dot ${event.provenance === "recorded" ? "recorded" : ""}`}
                    >
                      {event.provenance === "recorded" ? (
                        <Check size={12} />
                      ) : (
                        <Code2 size={12} />
                      )}
                    </span>
                    <div>
                      <div>
                        <strong>{event.title}</strong>
                        <Badge
                          tone={
                            event.provenance === "recorded" ? "blue" : "neutral"
                          }
                        >
                          {event.provenance === "recorded"
                            ? "App recorded"
                            : "Agent reported"}
                        </Badge>
                      </div>
                      <p>{event.description}</p>
                      <small>{event.time}</small>
                    </div>
                  </div>
                ))}
              </div>
            ) : tab === "context" ? (
              context ? (
                <>
                  <SectionHeading
                    title="Session inputs"
                    subtitle={`Prepared from ${context.checkpointId}, branch revision ${context.revision}.`}
                  />
                  <div className="context-summary-block">
                    <span className="field-mini-label">OBJECTIVE</span>
                    <p>{context.objective}</p>
                    <span className="field-mini-label">INSTRUCTIONS</span>
                    <p>{context.instructions}</p>
                  </div>
                  {context.sourceIds.map((id) => (
                    <button
                      className="source-detail-row"
                      key={id}
                      onClick={() =>
                        open({
                          type: "evidence",
                          artifactId: id,
                          source: context.sources[id],
                        })
                      }
                    >
                      <FileText size={16} />
                      <div>
                        <strong>
                          {state.flags.accessLost && id === "policy"
                            ? "Unavailable source"
                            : context.sources[id]?.title}
                        </strong>
                        <span>
                          Captured version {context.sources[id]?.version}
                        </span>
                      </div>
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </>
              ) : (
                <EmptyState
                  title="Session inputs incomplete"
                  description="This session includes a starting checkpoint and reported events. A full list of inputs is unavailable."
                />
              )
            ) : (
              <>
                <SectionHeading
                  title="Capture coverage"
                  subtitle="This sample includes the inputs and events marked as recorded."
                />
                <div className="coverage-rows">
                  {[
                    ["Objective and supplied instructions", true],
                    ["Selected captured source versions", !!context],
                    ["Recorded tool calls", true],
                    ["Client-reported progress", true],
                    ["Entire coding conversation", false],
                    ["Hidden model state", false],
                    ["Repository file diffs", false],
                    ["Verified test execution", false],
                  ].map(([label, saved]) => (
                    <div key={String(label)}>
                      <span>{label}</span>
                      <Badge tone={saved ? "green" : "neutral"}>
                        {saved ? "Recorded sample" : "Not captured"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <aside className="session-side">
          <div className="card padded-card">
            <SectionHeading
              title="Session decisions"
              action={<ShieldCheck size={16} />}
            />
            {questions.length ? (
              questions.map((q) => (
                <div className="session-question" key={q.id}>
                  <Badge tone={q.answer ? "green" : "amber"}>
                    {q.answer ? "Decision recorded" : "Needs your input"}
                  </Badge>
                  <h3>{q.title}</h3>
                  <p>{q.answer || q.description}</p>
                  {!q.answer ? (
                    <Button
                      variant="primary"
                      size="small"
                      onClick={() =>
                        open({ type: "question", questionId: q.id })
                      }
                    >
                      Record your decision
                      <ArrowRight size={13} />
                    </Button>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="muted small">
                No unanswered questions recorded for this session.
              </p>
            )}
          </div>
          <div className="card padded-card">
            <SectionHeading title="Session context" />
            <Link
              className="source-detail-row"
              to={`/branches/${run.branchId}`}
            >
              <GitBranch size={16} />
              <div>
                <strong>Open branch</strong>
                <span>{branch?.name}</span>
              </div>
              <ChevronRight size={14} />
            </Link>
            <Link
              className="source-detail-row"
              to={`/checkpoints/${run.checkpointId}`}
            >
              <Layers size={16} />
              <div>
                <strong>Starting checkpoint</strong>
                <span>{run.checkpointId}</span>
              </div>
              <ChevronRight size={14} />
            </Link>
            <Button
              size="small"
              onClick={() => setClosing(true)}
              disabled={run.status === "finished"}
            >
              Close sample run
            </Button>
          </div>
        </aside>
      </div>
      {closing ? (
        <Dialog
          title="Close this recorded run?"
          subtitle="Its inputs, events, and saved work remain in the sample history."
          onClose={() => setClosing(false)}
          footer={
            <>
              <Button onClick={() => setClosing(false)}>Keep open</Button>
              <Button
                variant="primary"
                onClick={() => {
                  act((s) => {
                    s.runs.find((r) => r.id === run.id)!.status = "finished";
                  }, "Sample session closed.");
                  setClosing(false);
                }}
              >
                Close run
              </Button>
            </>
          }
        >
          <Notice>
            Closing marks this sample session as finished.
          </Notice>
        </Dialog>
      ) : null}
    </div>
  );
}

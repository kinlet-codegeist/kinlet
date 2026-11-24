import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  GitBranch,
  Layers,
  Loader2,
  RotateCcw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../app-context";
import { demoDelay } from "../data/gateway";
import { capture, createBranch } from "../domain/model";
import {
  ArtifactIcon,
  Badge,
  Button,
  Dialog,
  Loading,
  Notice,
  RichText,
  TextField,
} from "./ui";

export function OverlayHost() {
  const { overlay } = useApp();
  if (!overlay) return null;
  switch (overlay.type) {
    case "capture":
      return <CaptureDialog />;
    case "branch":
      return <BranchDialog checkpointId={overlay.checkpointId} />;
    case "evidence":
      return (
        <EvidenceDrawer
          artifactId={overlay.artifactId}
          checkpointId={overlay.checkpointId}
          source={overlay.source}
        />
      );
    case "demo":
      return <DemoDrawer />;
    case "help":
      return <HelpDialog />;
    case "search":
      return <SearchDialog />;
    case "question":
      return <QuestionDialog questionId={overlay.questionId} />;
    default:
      return null;
  }
}
function CaptureDialog() {
  const { state, act, close } = useApp();
  const navigate = useNavigate();
  const [title, setTitle] = useState("Project checkpoint");
  const [note, setNote] = useState("");
  const [ids, setIds] = useState(Object.keys(state.artifacts));
  const [busy, setBusy] = useState("");
  const save = async () => {
    setBusy("Reading selected sample sources…");
    await demoDelay(450);
    setBusy("Saving checkpoint…");
    await demoDelay(450);
    const id = act(
      (s) => capture(s, title, note, ids),
      "Checkpoint saved locally.",
    );
    if (id) {
      close();
      navigate(`/checkpoints/${id}`);
    } else setBusy("");
  };
  return (
    <Dialog
      title="Save checkpoint"
      subtitle="Choose which sample tickets and pages to save."
      onClose={() => {
        if (!busy) close();
      }}
      footer={
        <>
          <span className="muted small">
            {ids.length} source{ids.length === 1 ? "" : "s"} selected
          </span>
          <Button onClick={close} disabled={!!busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={!!busy || !title.trim() || !ids.length}
          >
            {busy ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Layers size={14} />
            )}
            Save checkpoint
          </Button>
        </>
      }
    >
      {busy ? (
        <Loading label={busy} />
      ) : (
        <div className="form-stack">
          <TextField label="Checkpoint name">
            <input
              autoComplete="off"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </TextField>
          <TextField label="Checkpoint note">
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What changed, and why?"
            />
          </TextField>
          <div className="field-mini-label">Included sources</div>
          <div className="capture-sources">
            {Object.values(state.artifacts).map((a) => (
              <label key={a.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(a.id)}
                  onChange={(e) =>
                    setIds(
                      e.target.checked
                        ? [...ids, a.id]
                        : ids.filter((id) => id !== a.id),
                    )
                  }
                />
                <ArtifactIcon artifact={a} size={14} />
                <span>
                  {state.flags.accessLost && a.id === "policy"
                    ? "Unavailable source"
                    : a.key}
                </span>
                <small>v{a.version}</small>
              </label>
            ))}
          </div>
          <Notice>
            {ids.length === Object.keys(state.artifacts).length
              ? "This saves a complete snapshot of the tracked sample sources."
              : "This is a selective checkpoint. It will not replace the complete Main observation."}{" "}
            No real Jira or Confluence calls are made.
          </Notice>
        </div>
      )}
    </Dialog>
  );
}
function BranchDialog({ checkpointId }: { checkpointId?: string }) {
  const { state, act, close } = useApp();
  const navigate = useNavigate();
  const [base, setBase] = useState(checkpointId || state.observedId);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const save = () => {
    const id = act(
      (s) => createBranch(s, name, objective || name, base),
      "A new branch is ready. Main is unchanged.",
    );
    if (id) {
      close();
      navigate(`/branches/${id}`);
    }
  };
  return (
    <Dialog
      title="Create branch"
      subtitle="Start a parallel approach from a saved project checkpoint."
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!name.trim() || !base}
            onClick={save}
          >
            <GitBranch size={15} />
            Create branch
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <TextField label="Start from">
          <select value={base} onChange={(e) => setBase(e.target.value)}>
            {[...state.checkpoints].reverse().map((c) => (
              <option value={c.id} key={c.id}>
                {c.id} · {c.title}
              </option>
            ))}
          </select>
        </TextField>
        <TextField label="Branch name">
          <input
            placeholder="e.g. Guest checkout exploration"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </TextField>
        <TextField label="What are you exploring?">
          <textarea
            rows={3}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="What change will you explore on this branch?"
          />
        </TextField>
        <Notice>
          <strong>A separate working draft.</strong> Tasks, documents, and
          context stay on this branch until you publish reviewed changes.
        </Notice>
      </div>
    </Dialog>
  );
}
function EvidenceDrawer({
  artifactId,
  checkpointId,
  source,
}: {
  artifactId: string;
  checkpointId?: string;
  source?: import("../domain/types").Artifact;
}) {
  const { state, close } = useApp();
  const a =
    source ||
    (checkpointId
      ? state.checkpoints.find((c) => c.id === checkpointId)?.artifacts[
          artifactId
        ]
      : state.artifacts[artifactId]);
  const unavailable = state.flags.accessLost && artifactId === "policy";
  return (
    <Dialog
      title={
        unavailable ? "Source unavailable" : a?.title || "Source not found"
      }
      subtitle={
        unavailable
          ? "This sample source is restricted in the current scenario."
          : `${checkpointId ? `Captured in ${checkpointId}` : "Current sample source"} · ${a?.kind === "page" ? "Confluence" : "Jira"} · v${a?.version}`
      }
      onClose={close}
      drawer
      footer={
        <>
          <Badge tone="neutral">Local sample evidence</Badge>
          <Button onClick={close}>
            Done
            <Check size={14} />
          </Button>
        </>
      }
    >
      {unavailable ? (
        <div className="restricted-state">
          <ShieldCheck size={33} />
          <h3>Content is not available.</h3>
          <p>Restore access in Demo controls to inspect this source.</p>
        </div>
      ) : a ? (
        <>
          <div className="evidence-meta">
            <ArtifactIcon artifact={a} />
            <span>{a.key}</span>
            <Badge tone="blue">v{a.version}</Badge>
            <Badge>{a.status}</Badge>
          </div>
          <RichText text={a.description} />
          <div className="evidence-provenance">
            <ShieldCheck size={16} />
            <div>
              <strong>Source version</strong>
              <p>
                {checkpointId
                  ? "Saved in this checkpoint."
                  : "Current version in the sample workspace."}
              </p>
            </div>
          </div>
        </>
      ) : (
        <p>This artifact was not included in that checkpoint.</p>
      )}
    </Dialog>
  );
}
function DemoDrawer() {
  const { state, act, close, reset } = useApp();
  const navigate = useNavigate();
  const [resetConfirm, setResetConfirm] = useState(false);
  return (
    <Dialog
      title="Demo controls"
      subtitle="These controls apply to the sample workspace."
      onClose={close}
      drawer
    >
      <div className="small-heading">Sample scenarios</div>
      <div className="scenario-list">
        <Scenario
          title="AI unavailable"
          description="Turn off sample agent responses."
          checked={state.flags.aiUnavailable}
          onChange={(value) =>
            act((s) => {
              s.flags.aiUnavailable = value;
            })
          }
        />
        <Scenario
          title="A source becomes unavailable"
          description="The sample data-policy content is hidden from inspection."
          checked={state.flags.accessLost}
          onChange={(value) =>
            act((s) => {
              s.flags.accessLost = value;
            })
          }
        />
        <Scenario
          title="Interrupt the next publication"
          description="A multi-record publication pauses after its first update."
          checked={state.flags.partialPublish}
          onChange={(value) =>
            act((s) => {
              s.flags.partialPublish = value;
            })
          }
        />
      </div>
      <div className="sidebar-divider" />
      <div className="small-heading">REPLAY THE EXPERIENCE</div>
      <Button
        className="full-width"
        onClick={() => {
          reset(true);
          navigate("/setup");
        }}
      >
        Start from setup
        <ArrowRight size={14} />
      </Button>
      <Button
        className="full-width"
        onClick={() => {
          act((s) => {
            s.proposals.forEach((p) => {
              if (p.status !== "published") p.status = "rejected";
            });
            s.questions.forEach((q) => {
              q.answer = "Closed in quiet-workspace scenario.";
            });
            s.runs.forEach((r) => {
              r.status = "finished";
            });
            s.dismissed = [];
            s.pinned = [];
          }, "Quiet workspace scenario loaded.");
          close();
          navigate("/attention");
        }}
      >
        Try a quiet attention queue
        <CheckCircle2 size={14} />
      </Button>
      {resetConfirm ? (
        <Notice
          tone="warning"
          action={
            <Button
              variant="danger"
              size="small"
              onClick={() => {
                reset();
                navigate("/attention");
              }}
            >
              Reset now
            </Button>
          }
        >
          Replace your local sample edits with the original workspace?
        </Notice>
      ) : (
        <Button className="full-width" onClick={() => setResetConfirm(true)}>
          <RotateCcw size={14} />
          Reset sample workspace
        </Button>
      )}
      <div className="demo-footnote">
        <ShieldCheck size={14} />
        <p>
          Resetting clears this browser’s sample edits. Jira checkpoints stay on their tickets.
        </p>
      </div>
    </Dialog>
  );
}
function Scenario({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="scenario-row">
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        className="switch"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
function HelpDialog() {
  const { close } = useApp();
  const navigate = useNavigate();
  const steps = [
    ["Save a Jira checkpoint", "Save a ticket’s wording and compare it later.", "/jira"],
    [
      "Browse sample checkpoints",
      "Keep selected work, documents, and context together.",
      "/history",
    ],
    [
      "Explore a branch",
      "Try a parallel approach without changing Main.",
      "/branches",
    ],
    [
      "Inspect a sample agent session",
      "View supplied sources, instructions, and recorded activity.",
      "/sessions",
    ],
    [
      "Review a proposal",
      "Compare the current and proposed values, then choose which changes to publish.",
      "/reviews",
    ],
  ];
  return (
    <Dialog
      title="Kinlet guide"
      subtitle="Choose a task."
      onClose={close}
      wide
    >
      <div className="help-steps">
        {steps.map(([title, desc, to], i) => (
          <button
            key={title}
            onClick={() => {
              close();
              navigate(to);
            }}
          >
            <span>{String(i + 1).padStart(2, "0")}</span>
            <div>
              <strong>{title}</strong>
              <p>{desc}</p>
            </div>
            <ArrowRight size={16} />
          </button>
        ))}
      </div>
      <Notice>Sample branches, reviews, and sessions are saved in this browser.</Notice>
    </Dialog>
  );
}
function SearchDialog() {
  const { state, close, open } = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const results = [
    ...Object.values(state.artifacts)
      .filter((a) => !(state.flags.accessLost && a.id === "policy"))
      .map((a) => ({
        id: a.id,
        title: a.title,
        detail: a.key,
        type: "source",
      })),
    ...state.branches.map((b) => ({
      id: b.id,
      title: b.name,
      detail: `Branch · from ${b.baseId}`,
      type: "branch",
    })),
    ...state.checkpoints.map((c) => ({
      id: c.id,
      title: c.title,
      detail: `Checkpoint ${c.id}`,
      type: "checkpoint",
    })),
  ].filter((x) =>
    `${x.title} ${x.detail}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Dialog
      title="Search workspace"
      subtitle="Search this local sample workspace."
      onClose={close}
    >
      <div className="search-dialog-input">
        <Search size={18} />
        <input
          autoFocus
          aria-label="Search workspace"
          placeholder="A task, branch, or checkpoint…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd>ESC</kbd>
      </div>
      <div className="search-results">
        {results.slice(0, 10).map((x) => (
          <button
            key={`${x.type}-${x.id}`}
            onClick={() => {
              if (x.type === "source")
                open({ type: "evidence", artifactId: x.id });
              else {
                close();
                navigate(
                  x.type === "branch"
                    ? `/branches/${x.id}`
                    : `/checkpoints/${x.id}`,
                );
              }
            }}
          >
            <span className="search-result-icon">
              {x.type === "source" ? (
                <FileText size={17} />
              ) : x.type === "branch" ? (
                <GitBranch size={17} />
              ) : (
                <Layers size={17} />
              )}
            </span>
            <span>
              <strong>{x.title}</strong>
              <small>{x.detail}</small>
            </span>
            <ChevronRight size={14} />
          </button>
        ))}
        {!results.length ? (
          <p className="muted">
            No matching sample records. Try another phrase.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
function QuestionDialog({ questionId }: { questionId: string }) {
  const { state, act, close } = useApp();
  const [answer, setAnswer] = useState(
    "Keep PayPal as the provider. Support guest purchases without storing card details.",
  );
  const q = state.questions.find((q) => q.id === questionId);
  return (
    <Dialog
      title={q?.title || "Record a decision"}
      subtitle={q?.description}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Decide later</Button>
          <Button
            variant="primary"
            disabled={!answer.trim()}
            onClick={() => {
              act((s) => {
                const q = s.questions.find((q) => q.id === questionId);
                if (q) {
                  q.answer = answer;
                  const run = s.runs.find((r) => r.id === q.runId);
                  if (run) {
                    run.events.push({
                      title: "Human decision recorded",
                      description: answer,
                      time: "Just now",
                      provenance: "recorded",
                    });
                    run.status = "review";
                  }
                }
              }, "Your decision is attached to the sample session.");
              close();
            }}
          >
            Record decision
            <Check size={14} />
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <Notice>
          This answer becomes recorded context for the next draft. It does not
          send a message to an external agent.
        </Notice>
        <TextField label="Your decision">
          <textarea
            rows={5}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
        </TextField>
      </div>
    </Dialog>
  );
}

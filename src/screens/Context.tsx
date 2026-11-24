import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Layers,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApp } from "../app-context";
import {
  ArtifactIcon,
  Badge,
  Button,
  EmptyState,
  Notice,
  PageTitle,
  ProviderIcon,
  SectionHeading,
  TextField,
} from "../components/ui";
import { demoDelay } from "../data/gateway";
import { prepareContext, simulateAgent } from "../domain/model";
import { downloadJson } from "../platform/download";

export function ContextBuilder() {
  const { id } = useParams();
  const { state, act, notify, open } = useApp();
  const navigate = useNavigate();
  const b = state.branches.find((b) => b.id === id);
  const [objective, setObjective] = useState(b?.objective || "");
  const [instructions, setInstructions] = useState(
    "Preserve PayPal as the payment provider. Never store raw card details. Keep changes on this branch and submit them for human review.",
  );
  const [sources, setSources] = useState(
    ["checkout", "design", "policy"].filter((a) => b?.draft[a]),
  );
  const [busy, setBusy] = useState("");
  const [packId, setPackId] = useState<string | undefined>();
  if (!b)
    return (
      <div className="page">
        <EmptyState
          title="Choose a branch first"
          description="Context is prepared for an explicit branch and saved revision."
          action={
            <Link to="/branches" className="button button-primary">
              Open branches
            </Link>
          }
        />
      </div>
    );
  const pack =
    state.contexts.find((c) => c.id === packId) ||
    state.contexts.filter((c) => c.branchId === b.id).at(-1);
  const prepare = async () => {
    setBusy("Preparing versioned sample context…");
    await demoDelay(650);
    const result = act(
      (s) => prepareContext(s, b.id, objective, instructions, sources),
      "A new context pack is ready.",
    );
    setPackId(result);
    setBusy("");
  };
  const run = async () => {
    if (!pack) return;
    setBusy("Supplying captured context…");
    await demoDelay(500);
    setBusy("Preparing a sample agent draft…");
    await demoDelay(600);
    const pid = act(
      (s) => simulateAgent(s, pack.id),
      "Sample agent proposal created. No real AI was called.",
    );
    setBusy("");
    if (pid) navigate(`/reviews/${pid}`);
  };
  const copyPrompt = async () => {
    if (!pack) return;
    try {
      await navigator.clipboard.writeText(
        `Kinlet sample task\nObjective: ${pack.objective}\nBranch: ${b.name}\nStarting checkpoint: ${pack.checkpointId}\nContext pack: ${pack.id}\nInstructions: ${pack.instructions}\n\nThis workspace uses demo data. Real MCP tools are not connected.`,
      );
      notify("Sample task instructions copied.");
    } catch {
      notify(
        "Clipboard access is unavailable. Use Export context instead.",
        "error",
      );
    }
  };
  return (
    <div className="page">
      <Link to={`/branches/${b.id}`} className="back-link">
        <ArrowLeft size={14} />
        Back to {b.name}
      </Link>
      <PageTitle
        title="Prepare agent context"
        description="Choose the objective, instructions, and source versions for an agent session."
      />
      <div className="context-layout">
        <div className="context-main">
          <div className="card padded-card">
            <SectionHeading
              title="Session objective"
              action={
                <Badge tone="violet">
                  {b.baseId} · draft {b.revision}
                </Badge>
              }
            />
            <div className="form-stack">
              <TextField label="Objective">
                <textarea
                  rows={3}
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  placeholder="What should this session accomplish?"
                />
              </TextField>
              <TextField
                label="Instructions and constraints"
                hint="These instructions are saved with the selected sources."
              >
                <textarea
                  rows={4}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              </TextField>
            </div>
          </div>
          <div className="card padded-card">
            <SectionHeading
              title="Choose the supporting context"
              subtitle="The context pack records the current branch version of each selected source."
              action={
                <span className="muted small">{sources.length} selected</span>
              }
            />
            <div className="context-source-list">
              {Object.values(b.draft).map((a) => (
                <label className="context-source" key={a.id}>
                  <input
                    type="checkbox"
                    checked={sources.includes(a.id)}
                    onChange={(e) =>
                      setSources(
                        e.target.checked
                          ? [...sources, a.id]
                          : sources.filter((id) => id !== a.id),
                      )
                    }
                  />
                  <ArtifactIcon artifact={a} />
                  <span>
                    <strong>
                      {state.flags.accessLost && a.id === "policy"
                        ? "Unavailable source"
                        : a.title}
                    </strong>
                    <small>
                      {a.kind === "issue" ? a.key : "Confluence"} · captured v
                      {a.version}
                    </small>
                  </span>
                  <Badge tone={a.id === "policy" ? "amber" : "neutral"}>
                    {a.id === "policy" ? "Constraint" : "Source"}
                  </Badge>
                </label>
              ))}
            </div>
            <div className="context-bottom-note">
              <ShieldCheck size={14} />
              You can inspect what is supplied. No unrelated chats or hidden
              model state are captured.
            </div>
            <Button
              variant="primary"
              onClick={prepare}
              disabled={!!busy || !objective.trim() || !sources.length}
            >
              {busy.includes("context") ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Sparkles size={15} />
              )}
              Prepare context
              <ArrowRight size={14} />
            </Button>
          </div>
        </div>
        <aside className="context-side">
          <div className="card padded-card agent-launch-card">
            <div className="launch-provider">
              <ProviderIcon provider="Codex" size={44} />
              <div>
                <h2>Codex</h2>
                <span>Sample agent session</span>
              </div>
            </div>
            <p>
              Create a sample draft and proposal using the saved context pack.
            </p>
            <Button
              variant="primary"
              onClick={run}
              disabled={!pack || !!busy || pack.revision !== b.revision}
            >
              <Play size={14} />
              {busy || "Run sample agent"}
              {busy ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <ArrowRight size={14} />
              )}
            </Button>
            <button
              className="subtle-link"
              onClick={() => open({ type: "help" })}
            >
              Open Kinlet guide
              <ChevronRight size={13} />
            </button>
          </div>
          {pack ? (
            <div className="card padded-card context-ready">
              <div className="row-heading">
                <CheckCircle2 size={19} />
                <h2>Context pack prepared</h2>
              </div>
              <p>
                Prepared from <strong>{pack.checkpointId}</strong>, branch
                revision {pack.revision}.
              </p>
              <dl className="detail-list">
                <div>
                  <dt>Sources</dt>
                  <dd>{pack.sourceIds.length} captured versions</dd>
                </div>
                <div>
                  <dt>Instructions</dt>
                  <dd>Included</dd>
                </div>
                <div>
                  <dt>Capture</dt>
                  <dd>App inputs only</dd>
                </div>
                <div>
                  <dt>Branch</dt>
                  <dd>
                    {pack.revision === b.revision
                      ? "Matches saved draft"
                      : "Newer draft available"}
                  </dd>
                </div>
              </dl>
              <div className="context-pack-id">
                <Code2 size={13} />
                {pack.id}
              </div>
              <div className="context-source-pills">
                {pack.sourceIds.map((id) => (
                  <button
                    key={id}
                    className="source-chip compact"
                    onClick={() =>
                      open({
                        type: "evidence",
                        artifactId: id,
                        source: pack.sources[id],
                      })
                    }
                  >
                    <ArtifactIcon artifact={pack.sources[id]} size={12} />
                    {pack.sources[id].key}
                  </button>
                ))}
              </div>
              <div className="context-pack-actions">
                <Button size="small" onClick={copyPrompt}>
                  <Copy size={13} />
                  Copy task
                </Button>
                <Button
                  size="small"
                  onClick={() =>
                    downloadJson(`${pack.id}.json`, {
                      prototype: true,
                      context: pack,
                    })
                  }
                >
                  <Download size={13} />
                  Export
                </Button>
              </div>
            </div>
          ) : (
            <div className="context-placeholder">
              <Layers size={30} />
              <strong>Context pack contents</strong>
              <p>Your prepared sources and instructions will appear here.</p>
            </div>
          )}
          {state.flags.aiUnavailable ? (
            <Notice tone="warning">
              Sample agent responses are turned off in Demo controls.
            </Notice>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  GitCompare,
  GitPullRequest,
  Layers,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApp } from "../app-context";
import {
  ArtifactIcon,
  Avatar,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Notice,
  PageTitle,
  RichText,
  SectionHeading,
  Tabs,
  TextField,
} from "../components/ui";
import { demoDelay } from "../data/gateway";
import {
  branchChanges,
  createProposal,
  fieldLabel,
  saveArtifact,
} from "../domain/model";
import type { Artifact, Branch } from "../domain/types";

export function Branches() {
  const { state, open } = useApp();
  const [filter, setFilter] = useState("active");
  const branches = state.branches.filter(
    (b) =>
      filter === "all" || (b.status !== "archived" && b.status !== "published"),
  );
  return (
    <div className="page">
      <PageTitle
        title="Branches"
        description="Edit an alternative project state before submitting changes for review."
        actions={
          <Button variant="primary" onClick={() => open({ type: "branch" })}>
            <Plus size={15} />
            Create a branch
          </Button>
        }
      />
      <div className="branch-intro">
        <div className="branch-intro-art">
          <GitBranch size={31} />
          <span />
          <i />
        </div>
        <div>
          <strong>Changes stay on their branch</strong>
          <p>
            A branch keeps its own tasks, documentation, and context. Main
            changes only when you publish reviewed work.
          </p>
        </div>
        <ShieldCheck size={19} />
      </div>
      <div className="listing-toolbar">
        <Tabs
          items={[
            { id: "active", label: "Active branches" },
            { id: "all", label: "All branches", count: state.branches.length },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <span className="muted small">
          {branches.length} branch{branches.length === 1 ? "" : "es"}
        </span>
      </div>
      <div className="branch-grid">
        {branches.map((b) => (
          <BranchCard key={b.id} branch={b} />
        ))}
        <button
          className="new-branch-card"
          onClick={() => open({ type: "branch" })}
        >
          <span>
            <Plus size={23} />
          </span>
          <strong>New branch</strong>
          <p>
            Start from a saved checkpoint
            <br />
            to edit a separate project state.
          </p>
          <span className="text-link">
            Create a branch
            <ArrowRight size={13} />
          </span>
        </button>
      </div>
    </div>
  );
}
function BranchCard({ branch: b }: { branch: Branch }) {
  const { state } = useApp();
  const changes = branchChanges(state, b);
  const sourceDrift = Object.values(b.draft).some(
    (a) =>
      state.artifacts[a.id]?.description !==
      state.checkpoints.find((c) => c.id === b.baseId)?.artifacts[a.id]
        ?.description,
  );
  return (
    <article className="card branch-card">
      <div className="branch-card-top">
        <span className={`branch-square tone-${b.color}`}>
          <GitBranch size={21} />
        </span>
        <Badge
          tone={
            b.status === "published"
              ? "green"
              : b.status === "review"
                ? "violet"
                : b.status === "partial"
                  ? "amber"
                  : "neutral"
          }
        >
          {b.status === "review"
            ? "In review"
            : b.status === "published"
              ? "Published"
              : b.status === "partial"
                ? "Partly published"
                : "Draft"}
        </Badge>
      </div>
      <Link to={`/branches/${b.id}`}>
        <h2>{b.name}</h2>
      </Link>
      <p>{b.objective}</p>
      <div className="branch-card-meta">
        <span>
          <GitCommitHorizontal size={14} />
          From {b.baseId}
        </span>
        <span>
          <Layers size={14} />
          {new Set(changes.map((c) => c.artifactId)).size} changed sources
        </span>
      </div>
      {sourceDrift && b.status !== "published" ? (
        <div className="branch-freshness">
          <span className="tiny-dot amber" />
          Source context has changed
        </div>
      ) : (
        <div className="branch-freshness">
          <span className="tiny-dot green" />
          {b.status === "published"
            ? "Reviewed changes saved"
            : "Shared context attached"}
        </div>
      )}
      <div className="branch-card-footer">
        <div>
          <Avatar name={b.owner === "Codex" ? "Codex" : b.owner} size="small" />
          <span>{b.owner.split(" ")[0]}</span>
        </div>
        <Link className="text-link" to={`/branches/${b.id}`}>
          Open branch
          <ArrowRight size={13} />
        </Link>
      </div>
    </article>
  );
}
export function BranchDetail() {
  const { id } = useParams();
  const { state, act, notify } = useApp();
  const navigate = useNavigate();
  const b = state.branches.find((b) => b.id === id);
  const [selected, setSelected] = useState("checkout");
  const [tab, setTab] = useState("editor");
  const [proposalDialog, setProposalDialog] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  if (!b)
    return (
      <div className="page">
        <EmptyState
          title="Branch not found"
          description="Open a saved branch or start one from a checkpoint."
          icon="branch"
          action={
            <Link className="button button-primary" to="/branches">
              Open branches
            </Link>
          }
        />
      </div>
    );
  const a = b.draft[selected] || Object.values(b.draft)[0];
  const changes = branchChanges(state, b);
  const proposal = state.proposals.find(
    (p) => p.branchId === b.id && p.status === "submitted",
  );
  const select = (next: string) => {
    if (dirty) {
      setPending(next);
      return;
    }
    setSelected(next);
  };
  const submit = () => {
    const pid = act(
      (s) =>
        createProposal(
          s,
          b.id,
          title.trim() || `${b.name} proposal`,
          summary || b.objective,
        ),
      "Proposal saved for your review.",
    );
    if (pid) {
      setProposalDialog(false);
      navigate(`/reviews/${pid}`);
    }
  };
  const draftSummary = async () => {
    if (state.flags.aiUnavailable) {
      notify(
        "Simulated AI is unavailable. You can write the commit summary yourself.",
        "error",
      );
      return;
    }
    setBusy(true);
    await demoDelay();
    setTitle(`${b.name} · project changes`);
    setSummary(
      `Update ${new Set(changes.map((c) => c.artifactId)).size} selected sources to support: ${b.objective} Preserve the payment and privacy constraints, and review exact differences before publication.`,
    );
    setBusy(false);
  };
  return (
    <div className="page branch-detail-page">
      <Link className="back-link" to="/branches">
        <ArrowLeft size={14} />
        All branches
      </Link>
      <PageTitle
        eyebrow={`PROJECT BRANCH · FROM ${b.baseId}`}
        title={b.name}
        description={b.objective}
        actions={
          <>
            <Button onClick={() => setTab("changes")}>
              <GitCompare size={15} />
              Compare with Main
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setTitle(b.name);
                setProposalDialog(true);
              }}
              disabled={!changes.length || dirty}
            >
              <GitPullRequest size={15} />
              Submit for review
            </Button>
          </>
        }
      />
      <div className="branch-details-strip">
        <Badge tone="violet">
          <GitBranch size={12} />
          Independent draft
        </Badge>
        <span>Saved revision {b.revision}</span>
        <span>
          {changes.length} field change{changes.length === 1 ? "" : "s"}
        </span>
        <span>
          <ShieldCheck size={13} />
          Main stays at {state.observedId}
        </span>
        <Link to={`/branches/${b.id}/context`}>
          Prepare agent context
          <ArrowRight size={13} />
        </Link>
      </div>
      {b.baseId !== state.observedId ? (
        <Notice
          tone="warning"
          action={
            <Button
              size="small"
              variant="ghost"
              onClick={() => setTab("changes")}
            >
              Inspect differences
              <ArrowRight size={12} />
            </Button>
          }
        >
          This branch began at {b.baseId}. Main has been observed again at{" "}
          {state.observedId}; review the relevant differences before publishing.
        </Notice>
      ) : null}
      <div className="card branch-editor-card">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: "editor", label: "Working draft" },
            { id: "changes", label: "Changes", count: changes.length },
            { id: "context", label: "Context & sessions" },
          ]}
        />
        {tab === "editor" ? (
          <div className="branch-editor-layout">
            <aside className="artifact-tree">
              <div className="artifact-tree-label">JIRA WORK</div>
              {Object.values(b.draft)
                .filter((a) => a.kind === "issue")
                .map((item) => (
                  <button
                    key={item.id}
                    className={a.id === item.id ? "active" : ""}
                    onClick={() => select(item.id)}
                  >
                    <ArtifactIcon artifact={item} size={13} />
                    <span>{item.key}</span>
                    {changes.some((c) => c.artifactId === item.id) ? (
                      <i />
                    ) : null}
                  </button>
                ))}
              <div className="artifact-tree-label">CONFLUENCE</div>
              {Object.values(b.draft)
                .filter((a) => a.kind === "page")
                .map((item) => (
                  <button
                    key={item.id}
                    className={a.id === item.id ? "active" : ""}
                    onClick={() => select(item.id)}
                  >
                    <FileText size={14} />
                    <span>{item.key}</span>
                    {changes.some((c) => c.artifactId === item.id) ? (
                      <i />
                    ) : null}
                  </button>
                ))}
              <Link
                className="context-tree-link"
                to={`/branches/${b.id}/context`}
              >
                <Sparkles size={14} />
                Agent context
                <ChevronRight size={12} />
              </Link>
            </aside>
            <ArtifactEditor
              key={`${b.id}-${a.id}-${b.revision}`}
              branch={b}
              artifact={a}
              onDirty={setDirty}
            />
          </div>
        ) : tab === "changes" ? (
          <div className="padded-card">
            <SectionHeading
              title="Changes since checkpoint"
              subtitle="Your branch compared with its starting checkpoint. Current Main is shown for context."
            />
            {changes.length ? (
              changes.map((c) => (
                <div className="branch-change" key={c.id}>
                  <div className="row-heading">
                    <ArtifactIcon artifact={b.draft[c.artifactId]} />
                    <strong>{b.draft[c.artifactId].key}</strong>
                    <Badge>{fieldLabel(c.field)}</Badge>
                  </div>
                  <div className="three-column diff-columns">
                    <div className="diff-old">
                      <small>BASE · {b.baseId}</small>
                      <p>{c.before}</p>
                    </div>
                    <div className="diff-new">
                      <small>YOUR BRANCH</small>
                      <p>{c.after}</p>
                    </div>
                    <div className="diff-live">
                      <small>MAIN · {state.observedId}</small>
                      <p>{state.artifacts[c.artifactId][c.field]}</p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                title="No changes on this branch"
                description="Edit and save a source to compare it with its starting version."
              />
            )}
            {proposal ? (
              <Link
                className="button button-primary"
                to={`/reviews/${proposal.id}`}
              >
                Open submitted proposal
                <ArrowRight size={14} />
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="padded-card">
            <SectionHeading
              title="Agent context"
              subtitle="Choose the instructions and sources for this session."
              action={
                <Link
                  className="button button-primary"
                  to={`/branches/${b.id}/context`}
                >
                  <Sparkles size={14} />
                  Prepare context
                </Link>
              }
            />
            {state.runs
              .filter((r) => r.branchId === b.id)
              .map((r) => (
                <Link
                  className="source-detail-row"
                  key={r.id}
                  to={`/sessions/${r.id}`}
                >
                  <Sparkles size={17} />
                  <div>
                    <strong>{r.title}</strong>
                    <span>
                      {r.provider} · based on {r.checkpointId}
                    </span>
                  </div>
                  <ChevronRight size={14} />
                </Link>
              ))}
          </div>
        )}
      </div>
      {proposalDialog ? (
        <Dialog
          title="Submit changes for review"
          subtitle={`${changes.length} saved changes from ${b.name}. Main will remain unchanged.`}
          onClose={() => setProposalDialog(false)}
          footer={
            <>
              <Button onClick={() => setProposalDialog(false)}>
                Keep editing
              </Button>
              <Button
                variant="primary"
                disabled={!title.trim() || busy}
                onClick={submit}
              >
                Create proposal
                <ArrowRight size={14} />
              </Button>
            </>
          }
        >
          <div className="form-stack">
            <TextField label="Commit title">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What does this change accomplish?"
              />
            </TextField>
            <TextField label="What changed, and why?">
              <textarea
                rows={5}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Describe the changes and why they are needed."
              />
            </TextField>
            <Button onClick={draftSummary} disabled={busy}>
              <Sparkles size={14} />
              {busy ? "Preparing sample suggestion…" : "Draft a sample summary"}
            </Button>
            <Notice>
              You can edit the sample summary before submitting.
            </Notice>
          </div>
        </Dialog>
      ) : null}
      {pending ? (
        <Dialog
          title="Leave your unsaved draft?"
          subtitle="Save your changes before switching sources, or discard this unsaved edit."
          onClose={() => setPending(null)}
          footer={
            <>
              <Button onClick={() => setPending(null)}>Keep editing</Button>
              <Button
                variant="danger"
                onClick={() => {
                  setDirty(false);
                  setSelected(pending);
                  setPending(null);
                }}
              >
                Discard and switch
              </Button>
            </>
          }
        >
          <p>
            Discarding removes the edits made since your last save.
          </p>
        </Dialog>
      ) : null}
    </div>
  );
}
function ArtifactEditor({
  branch,
  artifact: a,
  onDirty,
}: {
  branch: Branch;
  artifact: Artifact;
  onDirty: (dirty: boolean) => void;
}) {
  const { state, act } = useApp();
  const [title, setTitle] = useState(a.title);
  const [description, setDescription] = useState(a.description);
  const [priority, setPriority] = useState(a.priority);
  const [preview, setPreview] = useState(false);
  const dirty =
    title !== a.title ||
    description !== a.description ||
    priority !== a.priority;
  useEffect(() => {
    onDirty(dirty);
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty, onDirty]);
  const unavailable = state.flags.accessLost && a.id === "policy";
  return (
    <div className="artifact-editor">
      <div className="editor-heading">
        <span>
          <ArtifactIcon artifact={a} />
          {unavailable ? "Unavailable source" : a.key}
        </span>
        <div>
          <span className="muted small">Captured v{a.version}</span>
          <Badge tone="violet">Branch draft</Badge>
        </div>
      </div>
      {unavailable ? (
        <EmptyState
          title="This source is unavailable"
          description="Sample access was removed. Restore it in Demo controls to inspect this content."
        />
      ) : !a.editable ? (
        <>
          <Notice>
            This source is captured for context. Editing is unavailable for this
            sample artifact.
          </Notice>
          <h2>{a.title}</h2>
          <RichText text={a.description} />
        </>
      ) : (
        <div className="form-stack">
          <TextField label={a.kind === "page" ? "Page title" : "Summary"}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Artifact title"
            />
          </TextField>
          <div className="editor-label-row">
            <label htmlFor="artifact-description">
              {a.kind === "page" ? "Page content" : "Description"}
            </label>
            <button onClick={() => setPreview(!preview)}>
              {preview ? "Edit text" : "Preview"}
            </button>
          </div>
          {preview ? (
            <div className="editor-preview">
              <RichText text={description} />
            </div>
          ) : (
            <textarea
              id="artifact-description"
              className="body-editor"
              rows={10}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
          <div className="editor-properties">
            <TextField label="Priority">
              <select
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as Artifact["priority"])
                }
              >
                {["Highest", "High", "Medium", "Low"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </TextField>
            <div>
              <span className="field-mini-label">Native status · captured</span>
              <Badge tone="blue">{a.status}</Badge>
            </div>
            <div>
              <span className="field-mini-label">Owner</span>
              <div className="owner-cell">
                <Avatar size="small" name={a.owner} />
                {a.owner}
              </div>
            </div>
          </div>
          <div className="editor-save-row">
            <span className={dirty ? "unsaved-text" : "saved-text"}>
              {dirty
                ? "You have unsaved changes."
                : "This draft matches its saved revision."}
            </span>
            <Button
              variant="primary"
              disabled={!dirty || !title.trim()}
              onClick={() => {
                act(
                  (s) =>
                    saveArtifact(
                      s,
                      branch.id,
                      a.id,
                      { title, description, priority },
                      branch.revision,
                    ),
                  "Branch draft saved. Main is unchanged.",
                );
                onDirty(false);
              }}
            >
              <Save size={14} />
              Save draft
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

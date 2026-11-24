import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  WorkspaceProposalReview,
  WorkspaceReceipt,
  WorkspaceRetention,
  WorkspaceDecisionSearch,
  WorkspaceSession,
} from "../components/WorkspaceWork";
import { Button, Notice, PageTitle } from "../components/ui";
import { LiveCheckoutDemo } from "../components/LiveCheckoutDemo";
import { DecisionFindings } from "../components/DecisionFindings";
import {
  BranchReferences,
  CitationEditor,
  CrossProjectImpact,
  TemplateSettings,
} from "../components/WorkspaceEvidence";
import type { DecisionFollowUps } from "../domain/decision-impact";
import {
  sourceKey,
  reviewFields,
  type Branch,
  type BranchRevision,
  type CheckpointSummary,
  type Coverage,
  type DraftChange,
  type Observation,
  type Scope,
  type SourceRef,
  type ReviewField,
  type ReviewTemplate,
} from "../domain/workspace";
import { plainText } from "../platform/atlassian-text";
import { parsePageId } from "../platform/confluence-plan";
import { downloadJson } from "../platform/download";
import { workspaceRequest } from "../platform/workspace";

type Workspace = {
  canManage: boolean;
  scope: Scope | null;
  checkpoints: CheckpointSummary[];
  branches: Branch[];
  proposals: Array<{ id: string; name: string; createdAt: string }>;
  runs: Array<{ id: string; createdAt: string }>;
  publications: Array<{ id: string; steps: string[] }>;
};
type Comparison = { saved: Observation; current: Observation };
type DraftWorkspace = {
  branch: Branch;
  base: CheckpointSummary;
  changes: DraftChange[];
  revisions: Omit<BranchRevision, "changes">[];
};
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The workspace request failed. Try again.";
const ids = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

export function LiveWorkspace({
  deepLink,
}: {
  deepLink?: { kind: string | null; id: string | null };
}) {
  const [workspace, setWorkspace] = useState<Workspace>();
  const [templates, setTemplates] = useState<ReviewTemplate[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [issues, setIssues] = useState("");
  const [pages, setPages] = useState("");
  const [name, setName] = useState("");
  const [opened, setOpened] = useState<
    | {
        id: string;
        kind: "checkpoint" | "branch" | "proposal" | "publication" | "session";
      }
    | undefined
  >(() => {
    const kind = deepLink?.kind,
      id = deepLink?.id;
    return id &&
      (kind === "proposal" ||
        kind === "publication" ||
        kind === "session" ||
        kind === "branch")
      ? { id, kind }
      : undefined;
  });
  const pendingCapture = useRef<{ name: string; id: string } | undefined>(
    undefined,
  );

  async function load() {
    const data = await workspaceRequest<Workspace>("load");
    setIssues(
      data.scope?.sources
        .filter((s) => s.kind === "jira")
        .map((s) => s.id)
        .join(", ") ?? "",
    );
    setPages(
      data.scope?.sources
        .filter((s) => s.kind === "confluence")
        .map((s) => s.id)
        .join(", ") ?? "",
    );
    setWorkspace(data);
  }
  async function perform(label: string, work: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    try {
      await work();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    void perform("Loading workspace…", load);
    void workspaceRequest<ReviewTemplate[]>("templates").then(
      setTemplates,
      () => {},
    );
  }, []);

  async function saveScope(event: FormEvent) {
    event.preventDefault();
    await perform("Saving sources…", async () => {
      await workspaceRequest("saveScope", {
        issues: ids(issues).map((issue) => issue.toUpperCase()),
        pages: ids(pages).map(parsePageId),
        revision: workspace?.scope?.revision ?? 0,
      });
      await load();
    });
  }
  async function capture(event: FormEvent) {
    event.preventDefault();
    const label = name.trim();
    if (!label) return;
    if (pendingCapture.current?.name !== label)
      pendingCapture.current = { name: label, id: crypto.randomUUID() };
    const requestId = pendingCapture.current.id;
    await perform(
      "Reading selected Jira tickets and Confluence pages…",
      async () => {
        await workspaceRequest("capture", { requestId, name: label });
        pendingCapture.current = undefined;
        setName("");
        setOpened({ id: requestId, kind: "checkpoint" });
        await load();
      },
    );
  }

  const directBranch = deepLink?.kind === "branch" && !!deepLink.id;
  const branchEditor = opened?.kind === "branch" && (
    <BranchEditor
      key={opened.id}
      branchId={opened.id}
      templates={templates}
      canManage={workspace?.canManage ?? false}
      onOpen={async (kind, id) => {
        await load();
        setOpened({ kind, id });
      }}
    />
  );

  return (
    <>
      <PageTitle
        title="Project workspace"
        description="Save selected Jira tickets and Confluence pages together. Compare checkpoints and try changes on a shared branch."
        actions={
          <div className="live-heading-actions">
            <Link
              className="button button-secondary button-normal"
              to="/jira?view=compare-decision"
            >
              Compare decision options
            </Link>
            <Link className="text-link" to="/jira">
              Back to Jira checkpoints
            </Link>
          </div>
        }
      />
      {busy && <p role="status">{busy}</p>}
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
      {directBranch && branchEditor}
      <LiveCheckoutDemo
        onBranch={async (id) => {
          await load();
          setOpened({ kind: "branch", id });
        }}
        onCheckpoint={async (id) => {
          await load();
          setOpened({ kind: "checkpoint", id });
        }}
      />
      <CrossProjectImpact />
      {workspace?.canManage && templates.length > 0 && (
        <TemplateSettings
          templates={templates}
          onSaved={(saved) =>
            setTemplates((items) =>
              items.map((item) => (item.id === saved.id ? saved : item)),
            )
          }
        />
      )}
      {!workspace && !busy && (
        <div className="live-heading-actions">
          <Button onClick={() => void perform("Loading workspace…", load)}>
            Retry
          </Button>
          <Button
            onClick={() =>
              void perform("Preparing workspace storage…", async () => {
                await workspaceRequest("initialize");
                await load();
              })
            }
          >
            Prepare workspace storage
          </Button>
        </div>
      )}
      {workspace?.canManage && (
        <section className="card padded-card workspace-card">
          <h2>Sources to capture</h2>
          <form onSubmit={(e) => void saveScope(e)} className="workspace-form">
            <label>
              Jira ticket keys or IDs
              <textarea
                rows={2}
                value={issues}
                onChange={(e) => setIssues(e.target.value)}
                placeholder="PAY-12, PAY-15"
                disabled={!!busy}
              />
            </label>
            <label>
              Confluence page URLs or IDs
              <textarea
                rows={2}
                value={pages}
                onChange={(e) => setPages(e.target.value)}
                disabled={!!busy}
              />
            </label>
            <p className="muted">
              Choose up to 20 tickets from this project and 5 pages from this
              site.
            </p>
            <Button
              type="submit"
              disabled={!!busy || (!issues.trim() && !pages.trim())}
            >
              Save sources
            </Button>
          </form>
        </section>
      )}
      {workspace && !workspace.scope && !workspace.canManage && (
        <Notice>
          Ask a Jira project administrator to choose the workspace sources.
        </Notice>
      )}
      {workspace?.canManage && workspace.scope && (
        <details className="card padded-card workspace-card">
          <summary>Session retention</summary>
          <WorkspaceRetention />
        </details>
      )}
      {workspace && (workspace.scope || workspace.checkpoints.length > 0) && (
        <section className="card padded-card workspace-card">
          <h2>Project checkpoints</h2>
          {workspace.scope && (
            <form className="workspace-form" onSubmit={(e) => void capture(e)}>
              <label>
                Checkpoint name
                <input
                  maxLength={100}
                  required
                  value={name}
                  placeholder="Before checkout launch"
                  onChange={(e) => setName(e.target.value)}
                  disabled={!!busy}
                />
              </label>
              <Button
                type="submit"
                variant="primary"
                disabled={!!busy || !name.trim()}
              >
                Save project checkpoint
              </Button>
            </form>
          )}
          {workspace.checkpoints.length ? (
            <ul className="workspace-records">
              {workspace.checkpoints.map((entry) => (
                <li key={entry.id}>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setOpened({ kind: "checkpoint", id: entry.id })
                    }
                  >
                    {entry.name}
                  </Button>
                  <small>
                    {entry.sourceCount} sources ·{" "}
                    {entry.finishedAt
                      ? new Date(entry.finishedAt).toLocaleString()
                      : "Capture pending"}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p>No project checkpoints saved yet.</p>
          )}
        </section>
      )}
      {workspace?.branches.length ? (
        <section className="card padded-card workspace-card">
          <h2>Shared branches</h2>
          <ul className="workspace-records">
            {workspace.branches.map((branch) => (
              <li key={branch.id}>
                <Button
                  variant="ghost"
                  onClick={() => setOpened({ kind: "branch", id: branch.id })}
                >
                  {branch.name}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {!!workspace &&
        (workspace.proposals.length > 0 ||
          workspace.runs.length > 0 ||
          workspace.publications.length > 0) && (
          <section className="card padded-card workspace-card">
            <h2>Review and session history</h2>
            <ul className="workspace-records">
              {workspace.proposals.map((entry) => (
                <li key={entry.id}>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setOpened({ kind: "proposal", id: entry.id })
                    }
                  >
                    {entry.name}
                  </Button>
                </li>
              ))}
              {workspace.runs.map((entry) => (
                <li key={entry.id}>
                  <Button
                    variant="ghost"
                    onClick={() => setOpened({ kind: "session", id: entry.id })}
                  >
                    Codex run · {new Date(entry.createdAt).toLocaleString()}
                  </Button>
                </li>
              ))}
              {workspace.publications.map((entry) => (
                <li key={entry.id}>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setOpened({ kind: "publication", id: entry.id })
                    }
                  >
                    Publication · {entry.id.slice(0, 8)}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      {opened?.kind === "proposal" && (
        <WorkspaceProposalReview
          key={opened.id}
          id={opened.id}
          onBranch={async (id) => {
            await load();
            setOpened({ kind: "branch", id });
          }}
          onApproved={async (id) => {
            await load();
            setOpened({ kind: "publication", id });
          }}
        />
      )}
      {opened?.kind === "publication" && (
        <WorkspaceReceipt
          key={opened.id}
          id={opened.id}
          onBranch={async (id) => {
            await load();
            setOpened({ kind: "branch", id });
          }}
          onReview={(id) => setOpened({ kind: "proposal", id })}
          onCheckpoint={async (id) => {
            await load();
            setOpened({ kind: "checkpoint", id });
          }}
        />
      )}
      {opened?.kind === "session" && (
        <WorkspaceSession key={opened.id} id={opened.id} />
      )}
      {opened?.kind === "checkpoint" && workspace && (
        <CheckpointReview
          key={opened.id}
          checkpoint={workspace.checkpoints.find(
            (entry) => entry.id === opened.id,
          )}
          entries={workspace.checkpoints}
          onBranch={async (id) => {
            await load();
            setOpened({ kind: "branch", id });
          }}
        />
      )}
      {!directBranch && branchEditor}
      <section className="card padded-card workspace-card">
        <WorkspaceDecisionSearch
          onOpen={(id) => setOpened({ kind: "publication", id })}
          onBranch={async (id) => {
            await load();
            setOpened({ kind: "branch", id });
          }}
        />
      </section>
    </>
  );
}

function CheckpointReview({
  checkpoint,
  entries,
  onBranch,
}: {
  checkpoint: CheckpointSummary | undefined;
  entries: CheckpointSummary[];
  onBranch: (id: string) => Promise<void>;
}) {
  const id = checkpoint?.id;
  const [coverage, setCoverage] = useState<Coverage>();
  const [source, setSource] = useState<SourceRef>();
  const [target, setTarget] = useState("");
  const [comparison, setComparison] = useState<Comparison>();
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!id) return;
    let active = true;
    workspaceRequest<Coverage>("coverage", { checkpointId: id }).then(
      (result) => {
        if (active) {
          setCoverage(result);
          setSource(result.sources[0]?.source);
        }
      },
      (err) => {
        if (active) setError(message(err));
      },
    );
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    if (!id || !source) return;
    let active = true;
    setComparison(undefined);
    workspaceRequest<Comparison>("compare", {
      baseId: id,
      currentId: target || undefined,
      source,
    }).then(
      (value) => {
        if (active) setComparison(value);
      },
      (err) => {
        if (active) setError(message(err));
      },
    );
    return () => {
      active = false;
    };
  }, [id, source, target]);

  if (!checkpoint) return null;
  const checkpointId = checkpoint.id;
  return (
    <section className="card padded-card workspace-card">
      <h2>{checkpoint.name}</h2>
      <p>
        Capture started {new Date(checkpoint.startedAt).toLocaleString()}
        {checkpoint.finishedAt &&
          " and finished " + new Date(checkpoint.finishedAt).toLocaleString()}
        .
      </p>
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
      {coverage ? (
        <>
          {coverage.unavailable > 0 && (
            <p>
              {coverage.unavailable} sources are unavailable to this account.
            </p>
          )}
          <SourcePicker
            coverage={coverage}
            source={source}
            onSelect={setSource}
          />
        </>
      ) : (
        !error && <p role="status">Checking source access…</p>
      )}
      {source && (
        <>
          <label className="live-select">
            Compare with
            <select
              value={target}
              onChange={(e) => {
                setError("");
                setTarget(e.target.value);
              }}
            >
              <option value="">Current Jira or Confluence</option>
              {entries
                .filter((entry) => entry.id !== id && entry.finishedAt)
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
            </select>
          </label>
          {comparison ? (
            <div className="live-versions">
              <Version
                heading="Saved checkpoint"
                observation={comparison.saved}
              />
              <Version
                heading={target ? "Compared checkpoint" : "Current source"}
                observation={comparison.current}
              />
            </div>
          ) : (
            !error && <p role="status">Reading versions…</p>
          )}
        </>
      )}
      {checkpoint.finishedAt && (
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              downloadJson(
                "kinlet-checkpoint-" + checkpointId.slice(0, 8) + ".json",
                await workspaceRequest("exportCheckpoint", { checkpointId }),
              );
            } catch (err) {
              setError(message(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Export visible checkpoint sources
        </Button>
      )}
      {checkpoint.finishedAt && (
        <form
          className="workspace-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            try {
              const result = await workspaceRequest<Branch>("createBranch", {
                checkpointId,
                name: branch,
                requestId: crypto.randomUUID(),
              });
              await onBranch(result.id);
            } catch (err) {
              setError(message(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            New branch name
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              maxLength={100}
              required
              disabled={busy}
            />
          </label>
          <Button disabled={busy || !branch.trim()} type="submit">
            Create branch
          </Button>
        </form>
      )}
    </section>
  );
}

function SourcePicker({
  coverage,
  source,
  onSelect,
}: {
  coverage: Coverage;
  source?: SourceRef;
  onSelect: (source: SourceRef) => void;
}) {
  if (!coverage.sources.length)
    return <p>No sources are visible in this checkpoint.</p>;
  return (
    <label className="live-select">
      Source
      <select
        value={source ? sourceKey(source) : ""}
        onChange={(e) => {
          const choice = coverage.sources.find(
            (item) => sourceKey(item.source) === e.target.value,
          );
          if (choice) onSelect(choice.source);
        }}
      >
        {coverage.sources.map((item) => (
          <option key={sourceKey(item.source)} value={sourceKey(item.source)}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Version({
  heading,
  observation,
}: {
  heading: string;
  observation: Observation;
}) {
  return (
    <article>
      <h3>{heading}</h3>
      {observation.status === "captured" ? (
        <>
          <strong>{observation.version.title}</strong>
          <p className="plan-wording">
            {plainText(observation.version.body) || "No text"}
          </p>
          <small>
            {observation.version.status} {observation.version.priority?.name}
          </small>
        </>
      ) : (
        <p>
          {observation.status === "too_large"
            ? "The source exceeds the capture limit."
            : observation.status === "pending"
              ? "Capture pending."
              : "Source unavailable."}
        </p>
      )}
    </article>
  );
}

function BranchEditor({
  branchId,
  onOpen,
  templates,
  canManage,
}: {
  branchId: string;
  templates: ReviewTemplate[];
  canManage: boolean;
  onOpen: (
    kind: "proposal" | "session" | "branch",
    id: string,
  ) => Promise<void>;
}) {
  const [forkName, setForkName] = useState("");
  const [older, setOlder] = useState<{
    revision: number;
    changes: DraftChange[];
  }>();
  const [priorityId, setPriorityId] = useState("");
  const [proposalName, setProposalName] = useState("");
  const [objective, setObjective] = useState("");
  const [instructions, setInstructions] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [citations, setCitations] = useState<
    NonNullable<DraftChange["citations"]>
  >({});
  const [disputed, setDisputed] = useState<ReviewField[]>([]);
  const [draft, setDraft] = useState<DraftWorkspace>();
  const [decision, setDecision] = useState<DecisionFollowUps | null>(null);
  const [coverage, setCoverage] = useState<Coverage>();
  const [source, setSource] = useState<SourceRef>();
  const [comparison, setComparison] = useState<Comparison>();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const repair = draft?.branch.repair;
  async function refresh() {
    const [record, savedDecision] = await Promise.all([
      workspaceRequest<DraftWorkspace>("branch", { branchId }),
      workspaceRequest<DecisionFollowUps | null>("branchDecision", {
        branchId,
      }),
    ]);
    const visible = await workspaceRequest<Coverage>("coverage", {
      checkpointId: record.base.id,
    });
    setDraft(record);
    const followUps = savedDecision?.plan ? savedDecision : null;
    setDecision(followUps);
    setCoverage(visible);
    setSource(
      (previous) =>
        record.branch.repair?.source ??
        (previous &&
        visible.sources.some(
          (item) => sourceKey(item.source) === sourceKey(previous),
        )
          ? previous
          : (
              visible.sources.find(
                ({ source }) =>
                  source.kind === "confluence" &&
                  source.id === followUps?.plan.id,
              ) ??
              visible.sources.find(({ source }) =>
                record.changes.some(
                  (change) => sourceKey(change.source) === sourceKey(source),
                ),
              ) ??
              visible.sources[0]
            )?.source),
    );
  }
  useEffect(() => {
    void refresh().catch((err) => setError(message(err)));
  }, [branchId]);
  useEffect(() => {
    if (!draft || !source) return;
    let active = true;
    setComparison(undefined);
    workspaceRequest<Comparison>("compare", {
      baseId: draft.base.id,
      source,
    }).then(
      (value) => {
        if (!active) return;
        setComparison(value);
        if (value.saved.status === "captured") {
          const previous = draft.changes.find(
            (change) => sourceKey(change.source) === sourceKey(source),
          );
          setTitle(previous?.title ?? value.saved.version.title);
          setPriorityId(
            previous?.priorityId ?? value.saved.version.priority?.id ?? "",
          );
          setBody(previous?.body ?? plainText(value.saved.version.body));
          setCitations(previous?.citations ?? {});
          setDisputed(previous?.disputed ?? []);
        }
      },
      (err) => {
        if (active) setError(message(err));
      },
    );
    return () => {
      active = false;
    };
  }, [draft, source]);

  async function save(e: { preventDefault(): void }, restoring = false) {
    e.preventDefault();
    if (!draft || !source || comparison?.saved.status !== "captured") return;
    setBusy(true);
    setError("");
    setNotice("");
    const base = comparison.saved.version;
    const change: DraftChange = {
      source,
      title,
      body,
      ...(priorityId && priorityId !== base.priority?.id && { priorityId }),
    };
    if (repair ? repair.field !== "title" : title === base.title)
      delete change.title;
    if (repair ? repair.field !== "body" : body === plainText(base.body))
      delete change.body;
    if (repair?.field === "priority") change.priorityId = priorityId;
    else if (repair) delete change.priorityId;
    if (restoring && comparison.current.status === "captured") {
      const live = comparison.current.version;
      change.title = live.title === base.title ? undefined : base.title;
      change.body =
        plainText(live.body) === plainText(base.body)
          ? undefined
          : plainText(base.body);
      change.priorityId =
        live.priority?.id === base.priority?.id ? undefined : base.priority?.id;
    }
    if (!restoring) {
      const active = reviewFields.filter(
        (field) =>
          change[field === "priority" ? "priorityId" : field] !== undefined,
      );
      change.citations = Object.fromEntries(
        active.flatMap((field) =>
          citations[field]?.length ? [[field, citations[field]]] : [],
        ),
      );
      change.disputed = disputed.filter((field) => active.includes(field));
    }
    try {
      const result = await workspaceRequest<{ revision: number }>("saveDraft", {
        branchId,
        expectedRevision: draft.branch.revision,
        requestId: crypto.randomUUID(),
        change,
      });
      await refresh();
      setNotice("Saved revision " + result.revision + ".");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function openWork(event: FormEvent, kind: "session" | "proposal") {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const result = await workspaceRequest<{ id: string }>(
        kind === "session" ? "openRun" : "submitProposal",
        {
          branchId,
          expectedRevision: draft.branch.revision,
          requestId: crypto.randomUUID(),
          ...(templateId && { templateId }),
          ...(kind === "session"
            ? { objective, instructions }
            : { name: proposalName }),
        },
      );
      await onOpen(kind, result.id);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card padded-card workspace-card">
      <div className="live-heading">
        <h2>{draft?.branch.name ?? "Shared branch"}</h2>
        <Button
          disabled={busy}
          onClick={() => {
            setError("");
            void refresh().catch((err) => setError(message(err)));
          }}
        >
          Refresh branch
        </Button>
      </div>
      {draft && (
        <p>
          Based on {draft.base.name} · Revision {draft.branch.revision}
        </p>
      )}
      {draft && (
        <BranchReferences
          key={draft.branch.id}
          branch={draft.branch}
          canManage={canManage}
        />
      )}
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {decision && (
        <section className="decision-option">
          <h3>Decision follow-ups</h3>
          <p>
            {decision.plan.title} · Based on Confluence v{decision.plan.version}
          </p>
          <blockquote className="decision-quote">
            {decision.option.wording}
          </blockquote>
          <DecisionFindings findings={decision.findings} />
          {!!decision.unavailable && (
            <p className="muted">Some saved tickets are no longer available.</p>
          )}
        </section>
      )}
      {repair && (
        <p>
          Repair scope ·{" "}
          {repair.field === "body"
            ? "Wording"
            : repair.field === "priority"
              ? "Priority"
              : "Title"}{" "}
          only. Attach a citation from the new checkpoint before submitting.
        </p>
      )}
      {coverage && !repair && (
        <SourcePicker
          coverage={coverage}
          source={source}
          onSelect={(next) => {
            setError("");
            setNotice("");
            setSource(next);
          }}
        />
      )}
      {comparison && (
        <div className="live-versions">
          <Version heading="Checkpoint" observation={comparison.saved} />
          <Version heading="Current source" observation={comparison.current} />
        </div>
      )}
      {comparison?.saved.status === "captured" && (
        <form className="workspace-form" onSubmit={(e) => void save(e)}>
          <label>
            Draft title
            <input
              maxLength={255}
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy || (!!repair && repair.field !== "title")}
            />
          </label>
          <label>
            Draft wording
            <textarea
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={busy || (!!repair && repair.field !== "body")}
            />
          </label>
          {source?.kind === "jira" && (
            <label>
              Jira priority ID
              <input
                inputMode="numeric"
                value={priorityId}
                pattern="[0-9]*"
                onChange={(e) => setPriorityId(e.target.value)}
                disabled={busy || (!!repair && repair.field !== "priority")}
              />
            </label>
          )}
          {coverage && draft && (
            <CitationEditor
              key={source ? sourceKey(source) : branchId}
              checkpointId={draft.base.id}
              onlyField={repair?.field}
              coverage={coverage}
              citations={citations}
              onChange={setCitations}
              disputed={disputed}
              onDispute={setDisputed}
            />
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !title.trim()}
          >
            Save draft revision
          </Button>
        </form>
      )}
      {!repair &&
        comparison?.saved.status === "captured" &&
        comparison.current.status === "captured" && (
          <Button disabled={busy} onClick={(event) => void save(event, true)}>
            Stage checkpoint values as a restore draft
          </Button>
        )}
      {draft && (
        <label className="live-select">
          Review template
          <select
            value={draft.branch.reviewTemplate?.id ?? templateId}
            disabled={!!draft.branch.reviewTemplate}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            <option value="">General review</option>
            {draft.branch.reviewTemplate ? (
              <option value={draft.branch.reviewTemplate.id}>
                {draft.branch.reviewTemplate.name}
              </option>
            ) : (
              templates.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))
            )}
          </select>
        </label>
      )}
      {(draft?.branch.reviewTemplate || templateId) && (
        <p className="muted">
          {draft?.branch.reviewTemplate?.instructions ??
            templates.find((item) => item.id === templateId)?.instructions}
        </p>
      )}
      {draft && (
        <details>
          <summary
            onClick={() => {
              if (!objective && decision)
                setObjective(
                  "Check the follow-ups for this decision and draft any needed Jira changes.",
                );
            }}
          >
            Prepare a Codex run
          </summary>
          <form
            className="workspace-form"
            onSubmit={(e) => void openWork(e, "session")}
          >
            <label>
              Objective
              <textarea
                maxLength={1000}
                value={objective}
                required
                rows={2}
                disabled={busy}
                onChange={(e) => setObjective(e.target.value)}
              />
            </label>
            <label>
              Instructions (optional)
              <textarea
                maxLength={4000}
                value={instructions}
                rows={3}
                disabled={busy}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </label>
            {decision && (
              <p className="muted">
                The context pack includes the visible decision follow-ups.
              </p>
            )}
            <Button type="submit" disabled={busy || !objective.trim()}>
              Create context pack
            </Button>
          </form>
        </details>
      )}
      {!!draft?.changes.length && (
        <details>
          <summary>Submit draft for review</summary>
          <form
            className="workspace-form"
            onSubmit={(e) => void openWork(e, "proposal")}
          >
            <label>
              Proposal name
              <input
                maxLength={100}
                value={proposalName}
                required
                disabled={busy}
                onChange={(e) => setProposalName(e.target.value)}
              />
            </label>
            <Button type="submit" disabled={busy || !proposalName.trim()}>
              Submit proposal
            </Button>
          </form>
        </details>
      )}
      {!!draft?.revisions.length && (
        <details>
          <summary>Revision history</summary>
          <ol>
            {draft.revisions.map((revision) => (
              <li key={revision.revision}>
                <Button
                  variant="ghost"
                  size="small"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    setOlder(undefined);
                    try {
                      setOlder(
                        await workspaceRequest("revision", {
                          branchId,
                          revision: revision.revision,
                        }),
                      );
                    } catch (err) {
                      setError(message(err));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Open revision {revision.revision}
                </Button>{" "}
                · {new Date(revision.createdAt).toLocaleString()}
              </li>
            ))}
          </ol>
          {older && (
            <article>
              <h3>Revision {older.revision}</h3>
              <form
                className="workspace-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    const fork = await workspaceRequest<{ id: string }>(
                      "forkRevision",
                      {
                        branchId,
                        revision: older.revision,
                        name: forkName,
                        requestId: crypto.randomUUID(),
                      },
                    );
                    await onOpen("branch", fork.id);
                  } catch (err) {
                    setError(message(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  New branch name
                  <input
                    value={forkName}
                    required
                    maxLength={100}
                    disabled={busy}
                    onChange={(event) => setForkName(event.target.value)}
                  />
                </label>
                <Button type="submit" disabled={busy || !forkName.trim()}>
                  Fork this revision
                </Button>
              </form>
              {older.changes.length ? (
                older.changes.map((change) => (
                  <div
                    className="workspace-choice"
                    key={sourceKey(change.source)}
                  >
                    <strong>
                      {coverage?.sources.find(
                        (item) =>
                          sourceKey(item.source) === sourceKey(change.source),
                      )?.label ?? "Source"}
                    </strong>
                    {change.title && <p>{change.title}</p>}
                    {change.body !== undefined && (
                      <p className="plan-wording">
                        {change.body || "Clear wording"}
                      </p>
                    )}
                    {change.priorityId && (
                      <p>Priority ID {change.priorityId}</p>
                    )}
                  </div>
                ))
              ) : (
                <p>No visible draft changes.</p>
              )}
            </article>
          )}
        </details>
      )}
    </section>
  );
}

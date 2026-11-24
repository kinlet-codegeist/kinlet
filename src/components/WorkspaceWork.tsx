import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "./ui";
import type {
  PublicationStep,
  ReviewChoice,
  SessionExport,
  WorkspaceQuestion,
  WorkspaceRun,
} from "../domain/workspace";
import { runtime } from "../platform/runtime";
import { workspaceRequest } from "../platform/workspace";
import { downloadJson } from "../platform/download";
import { CitationList, WorkspaceTimeline } from "./WorkspaceEvidence";

type Preview = { name: string; choices: ReviewChoice[]; unavailable: number };
type Receipt = {
  id: string;
  proposalId: string;
  reason: string;
  approvedAt: string;
  canContinue: boolean;
  fieldApproval?: boolean;
  steps: Array<{
    index: number;
    label: string;
    status: PublicationStep["status"];
    field?: ReviewChoice["field"];
  }>;
};
type RunDetail = {
  run: Partial<WorkspaceRun>;
  session?: SessionExport;
  own: boolean;
  visible?: boolean;
  questions?: WorkspaceQuestion[];
  canRemove?: boolean;
};
const reviewLabels = {
  title: "Title",
  body: "Wording",
  priority: "Jira priority ID",
};
const stepLabels = {
  pending: "Ready to apply",
  applied: "Applied",
  already_present: "Approved wording verified",
  verification_required: "Verify the result before continuing",
  source_changed: "Review again",
};
export const workspaceMessage = (err: unknown) =>
  err instanceof Error
    ? err.message
    : "The workspace request failed. Try again.";

export function WorkspaceProposalReview({
  id,
  onApproved,
  onBranch,
}: {
  id: string;
  onApproved: (id: string) => Promise<void>;
  onBranch: (id: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview>();
  const [selected, setSelected] = useState<string[]>([]);
  const [follow, setFollow] = useState<string[]>([]);
  const [followName, setFollowName] = useState("");
  const followRequest = useRef<{ key: string; id: string } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const attempt = useRef<{ key: string; requestId: string } | null>(null);
  async function load() {
    setBusy(true);
    setError("");
    setSelected([]);
    setFollow([]);
    try {
      setPreview(
        await workspaceRequest<Preview>("previewProposal", { proposalId: id }),
      );
    } catch (err) {
      setPreview(undefined);
      setError(workspaceMessage(err));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  const approved =
    preview?.choices.filter((item) => selected.includes(item.id)) ?? [];
  async function approve(event: FormEvent) {
    event.preventDefault();
    const selection = approved.map(({ id, evidence }) => ({ id, evidence }));
    const key = JSON.stringify([id, reason.trim(), selection]);
    if (attempt.current?.key !== key)
      attempt.current = { key, requestId: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const result = await workspaceRequest<{ id: string }>("approve", {
        proposalId: id,
        requestId: attempt.current.requestId,
        reason,
        selection,
      });
      await onApproved(result.id);
    } catch (err) {
      setError(workspaceMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card padded-card workspace-card">
      <div className="live-heading">
        <h2>{preview?.name ?? "Review proposal"}</h2>
        <Button disabled={busy} onClick={() => void load()}>
          Refresh comparison
        </Button>
      </div>
      {busy && <p role="status">Checking proposal…</p>}
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
      {preview && (
        <form
          className="workspace-form"
          onSubmit={(event) => void approve(event)}
        >
          {!!preview.unavailable && (
            <p>{preview.unavailable} proposed sources are unavailable.</p>
          )}
          {!preview.choices.length && (
            <p>No visible proposed fields need changes.</p>
          )}
          {preview.choices.map((choice) => (
            <article className="workspace-choice" key={choice.id}>
              <h3>
                {choice.label} · {reviewLabels[choice.field]}
              </h3>
              {choice.conflict && (
                <p className="handoff-plan-change">
                  The current source differs from the checkpoint.
                </p>
              )}
              {choice.citations?.length ? (
                <CitationList citations={choice.citations} />
              ) : null}
              {choice.hold && (
                <p className="handoff-plan-change">
                  {choice.hold === "evidence_unavailable"
                    ? "Draft hidden because a cited source is unavailable."
                    : choice.hold === "disputed"
                      ? "Resolve the conflicting citations in a follow-up branch."
                      : "Check the changed evidence before approving this edit."}
                </p>
              )}
              <div className="proposal-passages">
                <section>
                  <h4>Checkpoint</h4>
                  <p className="plan-wording">{choice.base || "Empty"}</p>
                </section>
                <section>
                  <h4>Current source</h4>
                  <p className="plan-wording">{choice.current || "Empty"}</p>
                </section>
                <section>
                  <h4>Proposed</h4>
                  <p className="plan-wording">
                    {choice.hold === "evidence_unavailable"
                      ? "Unavailable"
                      : choice.proposed || "Empty"}
                  </p>
                </section>
              </div>
              <label className="workspace-checkbox">
                <input
                  type="checkbox"
                  disabled={busy || !choice.available}
                  checked={selected.includes(choice.id)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setSelected((previous) =>
                      checked
                        ? [...previous, choice.id]
                        : previous.filter((value) => value !== choice.id),
                    );
                  }}
                />
                {choice.available
                  ? "Approve this field"
                  : choice.hold
                    ? "Review evidence first"
                    : "This wording needs an edit that preserves formatting or field permissions"}
              </label>
              {choice.hold === "evidence_changed" && (
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const branch = await workspaceRequest<{ id: string }>(
                        "repair",
                        { proposalId: id, fieldId: choice.id },
                      );
                      await onBranch(branch.id);
                    } catch (err) {
                      setError(workspaceMessage(err));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Revise held edit
                </Button>
              )}
              {choice.hold === "evidence_unavailable" && (
                <p>
                  Restore access to the cited record, then refresh the
                  comparison to prepare a repair.
                </p>
              )}
              {choice.hold !== "evidence_unavailable" &&
                (choice.hold ||
                  choice.conflict ||
                  (choice.citations?.length ?? 0) >= 2) && (
                  <label className="workspace-checkbox">
                    <input
                      type="checkbox"
                      checked={follow.includes(choice.id)}
                      disabled={busy}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setFollow((items) =>
                          checked
                            ? [...items, choice.id]
                            : items.filter((item) => item !== choice.id),
                        );
                      }}
                    />{" "}
                    Carry this field into a follow-up
                  </label>
                )}
              {!choice.hold && (choice.citations?.length ?? 0) >= 2 && (
                <Button
                  size="small"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await workspaceRequest("disputeEvidence", {
                        proposalId: id,
                        field: choice.id,
                      });
                      await load();
                    } catch (err) {
                      setError(workspaceMessage(err));
                      setBusy(false);
                    }
                  }}
                >
                  Mark citations as conflicting
                </Button>
              )}
            </article>
          ))}
          {!!preview.choices.length && (
            <>
              <label>
                Reason for approving these changes
                <textarea
                  value={reason}
                  rows={2}
                  maxLength={600}
                  required
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <Button
                type="submit"
                variant="primary"
                disabled={busy || !approved.length || !reason.trim()}
              >
                Approve selected fields
              </Button>
            </>
          )}
        </form>
      )}
      {follow.length > 0 && (
        <form
          className="workspace-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            const key = JSON.stringify([followName.trim(), follow]);
            if (followRequest.current?.key !== key)
              followRequest.current = { key, id: crypto.randomUUID() };
            try {
              const branch = await workspaceRequest<{ id: string }>(
                "followUp",
                {
                  proposalId: id,
                  name: followName,
                  fields: follow,
                  requestId: followRequest.current.id,
                },
              );
              await onBranch(branch.id);
            } catch (err) {
              setError(workspaceMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Follow-up branch name
            <input
              required
              maxLength={100}
              value={followName}
              onChange={(event) => setFollowName(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy || !followName.trim()}>
            Create follow-up branch
          </Button>
        </form>
      )}
      <WorkspaceTimeline proposalId={id} />
    </section>
  );
}

export function WorkspaceReceipt({
  id,
  onCheckpoint,
  onReview,
  onBranch,
  onApplied,
}: {
  id: string;
  onCheckpoint: (id: string) => Promise<void>;
  onApplied?: () => Promise<void>;
  onReview: (id: string) => void;
  onBranch: (id: string) => Promise<void>;
}) {
  const [receipt, setReceipt] = useState<Receipt>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [reversalName, setReversalName] = useState("");
  const reversalRequest = useRef<{ name: string; id: string } | null>(null);
  async function load() {
    setReceipt(
      await workspaceRequest<Receipt>("publication", { publicationId: id }),
    );
  }
  async function perform(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err) {
      setError(workspaceMessage(err));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void perform(load);
  }, [id]);
  const next = receipt?.steps.find(
    (step) =>
      step.status !== "applied" &&
      step.status !== "already_present" &&
      (!receipt.fieldApproval || step.status !== "source_changed"),
  );
  const held = receipt?.steps.some((step) => step.status === "source_changed");
  return (
    <section className="card padded-card workspace-card">
      <div className="live-heading">
        <h2>Publication receipt</h2>
        <Button disabled={busy} onClick={() => void perform(load)}>
          Refresh receipt
        </Button>
      </div>
      {busy && <p role="status">Checking publication…</p>}
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
      {receipt && (
        <>
          <p>{receipt.reason}</p>
          <ol>
            {receipt.steps.map((step) => (
              <li key={step.index}>
                {step.label}
                {step.field && " · " + reviewLabels[step.field]} ·{" "}
                {stepLabels[step.status]}
              </li>
            ))}
          </ol>
          <div className="live-heading-actions">
            {receipt.canContinue &&
              next &&
              next.status !== "source_changed" && (
                <Button
                  disabled={busy}
                  variant="primary"
                  onClick={() =>
                    void perform(async () => {
                      await workspaceRequest("publishNext", {
                        publicationId: id,
                      });
                      await load();
                      await onApplied?.();
                    })
                  }
                >
                  {next.status === "verification_required"
                    ? "Verify and continue"
                    : "Apply next approved record"}
                </Button>
              )}
            <Button onClick={() => onReview(receipt.proposalId)}>
              {held ? "Review remaining changes" : "Open reviewed proposal"}
            </Button>
            {!next && !held && (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await workspaceRequest("capturePublished", {
                      publicationId: id,
                    });
                    await onCheckpoint(id);
                  })
                }
              >
                Save result checkpoint
              </Button>
            )}
          </div>
          {!next &&
            !held &&
            receipt.steps.some(({ status }) => status === "applied") && (
              <details>
                <summary>Stage a reversal</summary>
                <form
                  className="workspace-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const name = reversalName.trim();
                    if (reversalRequest.current?.name !== name)
                      reversalRequest.current = {
                        name,
                        id: crypto.randomUUID(),
                      };
                    const requestId = reversalRequest.current.id;
                    void perform(async () => {
                      const branch = await workspaceRequest<{ id: string }>(
                        "reversePublication",
                        { publicationId: id, name, requestId },
                      );
                      await onBranch(branch.id);
                    });
                  }}
                >
                  <label>
                    Reversal branch name
                    <input
                      required
                      maxLength={100}
                      value={reversalName}
                      onChange={(event) => setReversalName(event.target.value)}
                    />
                  </label>
                  <Button type="submit" disabled={busy || !reversalName.trim()}>
                    Create reversal draft
                  </Button>
                </form>
              </details>
            )}
          <WorkspaceTimeline proposalId={receipt.proposalId} />
        </>
      )}
    </section>
  );
}

const eventLabels = {
  user_message: "User message",
  agent_message: "Codex message",
  turn_started: "Turn started",
  turn_completed: "Turn completed",
  tool_completed: "Tool completed",
  files_changed: "Files changed",
  turn_failed: "Turn failed",
};

export function WorkspaceSession({ id }: { id: string }) {
  const [detail, setDetail] = useState<RunDetail>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<number[]>([]);
  const [remove, setRemove] = useState(false);
  const [session, setSession] = useState<SessionExport>();
  const [busy, setBusy] = useState(true);
  async function load() {
    setDetail(await workspaceRequest<RunDetail>("run", { runId: id }));
  }
  useEffect(() => {
    setBusy(true);
    load()
      .catch((err) => setError(workspaceMessage(err)))
      .finally(() => setBusy(false));
  }, [id]);
  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (err) {
      setError(workspaceMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const visibleEvents = session?.events ?? detail?.session?.events;
  return (
    <section className="card padded-card workspace-card">
      <h2>Codex session</h2>
      <details>
        <summary>Connection references</summary>
        <dl>
          <dt>Jira project ID</dt>
          <dd>
            <code>{runtime.projectId}</code>
          </dd>
          <dt>Run ID</dt>
          <dd>
            <code>{id}</code>
          </dd>
        </dl>
      </details>
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {detail?.run.objective && <p>{detail.run.objective}</p>}
      {detail?.run.revision !== undefined && (
        <p>Context prepared from branch revision {detail.run.revision}.</p>
      )}
      {busy && <p role="status">Reading session…</p>}
      {detail && !detail.visible && (
        <p>
          This account can see the run reference. Source access is required to
          view the session.
        </p>
      )}
      {detail?.own && detail.visible && (
        <>
          <Button
            size="small"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                type Context = {
                  sources: Array<{ source: { kind: string; id: string } }>;
                  [key: string]: unknown;
                };
                type Part = {
                  body?: string;
                  status: string;
                  nextOffset: number | null;
                  [key: string]: unknown;
                };
                const pack = await workspaceRequest<Context>("context", {
                  runId: id,
                });
                const sources = [];
                for (const item of pack.sources) {
                  const first = await workspaceRequest<Part>("context", {
                    runId: id,
                    source: item.source,
                  });
                  if (first.status !== "captured")
                    throw new Error(
                      "A source became unavailable. Request a fresh context pack.",
                    );
                  let body = first.body ?? "";
                  let offset = first.nextOffset;
                  while (typeof offset === "number") {
                    const part = await workspaceRequest<Part>("context", {
                      runId: id,
                      source: item.source,
                      offset,
                    });
                    if (part.status !== "captured")
                      throw new Error(
                        "A source became unavailable. Request a fresh context pack.",
                      );
                    body += part.body ?? "";
                    offset = part.nextOffset;
                  }
                  sources.push({ ...item, ...first, body, nextOffset: null });
                }
                downloadJson("kinlet-context-" + id.slice(0, 8) + ".json", {
                  ...pack,
                  sources,
                });
                setNotice("Context downloaded for the local Codex companion.");
              })
            }
          >
            Download context pack
          </Button>
          <label className="workspace-form">
            Choose a Codex session export
            <input
              type="file"
              accept=".json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                setSession(undefined);
                if (file)
                  void perform(async () => {
                    if (file.size > 96 * 1024)
                      throw new Error("Choose a session export under 96 KB.");
                    const value = JSON.parse(
                      await file.text(),
                    ) as SessionExport;
                    if (
                      value.format !== "kinlet.codex-session.v1" ||
                      value.runId !== id ||
                      !Array.isArray(value.events)
                    )
                      throw new Error("Choose a Kinlet export for this run.");
                    if (
                      !value.events.every(
                        (event) =>
                          event &&
                          event.kind in eventLabels &&
                          typeof event.at === "string" &&
                          (event.text === undefined ||
                            typeof event.text === "string"),
                      )
                    )
                      throw new Error(
                        "The export contains an unsupported session event.",
                      );
                    setExcluded([]);
                    setSession(value);
                  });
              }}
            />
          </label>
          {session && (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await workspaceRequest("importSession", {
                    runId: id,
                    session: {
                      ...session,
                      events: session.events.filter(
                        (_, i) => !excluded.includes(i),
                      ),
                    },
                  });
                  setSession(undefined);
                  await load();
                  setNotice("The session was added to this workspace.");
                })
              }
            >
              Share selected session events
            </Button>
          )}
        </>
      )}
      {detail?.visible && (
        <>
          <h3>Questions</h3>
          {detail.own && (
            <form
              className="workspace-form"
              onSubmit={(event) => {
                event.preventDefault();
                void perform(async () => {
                  await workspaceRequest("ask", {
                    runId: id,
                    requestId: crypto.randomUUID(),
                    question,
                  });
                  setQuestion("");
                  await load();
                });
              }}
            >
              <label>
                Ask the team
                <textarea
                  value={question}
                  rows={2}
                  maxLength={600}
                  required
                  disabled={busy}
                  onChange={(event) => setQuestion(event.target.value)}
                />
              </label>
              <Button type="submit" disabled={busy || !question.trim()}>
                Post question
              </Button>
            </form>
          )}
          {detail.questions?.map((item) => (
            <article key={item.id} className="workspace-choice">
              <p>{item.question}</p>
              {item.answer ? (
                <p>{item.answer}</p>
              ) : (
                <form
                  className="workspace-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform(async () => {
                      await workspaceRequest("answer", {
                        questionId: item.id,
                        answer: answers[item.id],
                      });
                      await load();
                    });
                  }}
                >
                  <label>
                    Answer
                    <textarea
                      required
                      rows={2}
                      maxLength={600}
                      value={answers[item.id] ?? ""}
                      disabled={busy}
                      onChange={(event) =>
                        setAnswers({
                          ...answers,
                          [item.id]: event.target.value,
                        })
                      }
                    />
                  </label>
                  <Button
                    type="submit"
                    disabled={busy || !answers[item.id]?.trim()}
                  >
                    Save answer
                  </Button>
                </form>
              )}
            </article>
          ))}
        </>
      )}
      {detail?.session &&
        detail.canRemove &&
        (remove ? (
          <div className="live-heading-actions">
            <p>Remove the shared session export from Kinlet?</p>
            <Button disabled={busy} onClick={() => setRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await workspaceRequest("removeSession", { runId: id });
                  setRemove(false);
                  await load();
                  setNotice("Shared session export removed.");
                })
              }
            >
              Remove session export
            </Button>
          </div>
        ) : (
          <Button disabled={busy} onClick={() => setRemove(true)}>
            Remove shared export…
          </Button>
        ))}
      {visibleEvents && (
        <>
          <h3>
            {session ? "Preview before sharing" : "Recorded session events"}
          </h3>
          <p className="muted">
            File and tool events show what Codex reported during the run.
          </p>
          <ol>
            {visibleEvents.map((item, i) => (
              <li key={i}>
                {session && (
                  <label>
                    <input
                      type="checkbox"
                      checked={!excluded.includes(i)}
                      disabled={busy}
                      onChange={(event) => {
                        const keep = event.target.checked;
                        setExcluded((previous) =>
                          keep
                            ? previous.filter((index) => index !== i)
                            : [...previous, i],
                        );
                      }}
                    />{" "}
                    Share event {i + 1}
                  </label>
                )}
                <strong>{eventLabels[item.kind]}</strong> ·{" "}
                {new Date(item.at).toLocaleString()}
                {item.text && <p className="plan-wording">{item.text}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

export function WorkspaceRetention() {
  const [days, setDays] = useState("keep");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (err) {
      setError(workspaceMessage(err));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void perform(async () => {
      const result = await workspaceRequest<{ days: number | null }>(
        "retention",
      );
      setDays(result.days === null ? "keep" : String(result.days));
    });
  }, []);
  return (
    <form
      className="workspace-form"
      onSubmit={(event) => {
        event.preventDefault();
        void perform(async () => {
          await workspaceRequest("saveRetention", {
            days: days === "keep" ? null : Number(days),
          });
          setNotice("Session retention saved.");
        });
      }}
    >
      <label>
        Shared Codex session retention
        <select
          value={days}
          disabled={busy}
          onChange={(event) => setDays(event.target.value)}
        >
          <option value="keep">Keep until removed</option>
          {[30, 90, 365].map((day) => (
            <option key={day} value={day}>
              {day} days
            </option>
          ))}
        </select>
      </label>
      <p>
        Expired session exports disappear from run details. A project
        administrator can remove the stored exports.
      </p>
      <div className="live-heading-actions">
        <Button type="submit" disabled={busy}>
          Save retention
        </Button>
        <Button
          disabled={busy || days === "keep"}
          onClick={() =>
            void perform(async () => {
              const result = await workspaceRequest<{ count: number }>(
                "removeExpiredSessions",
              );
              setNotice(
                "Removed " + result.count + " expired session exports.",
              );
            })
          }
        >
          Remove expired session exports
        </Button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function WorkspaceDecisionSearch({
  onOpen,
  onBranch,
}: {
  onOpen: (id: string) => void;
  onBranch: (id: string) => Promise<void>;
}) {
  type Hit = {
    publicationId: string;
    title: string;
    reason: string;
    project?: string;
  };
  const [query, setQuery] = useState("");
  const [sourceProject, setSourceProject] = useState("");
  const [selected, setSelected] = useState<Hit>();
  const [destination, setDestination] = useState("");
  const [draftName, setDraftName] = useState("");
  const reuseRequest = useRef<{ key: string; id: string } | null>(null);
  const [hits, setHits] = useState<Hit[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details>
      <summary>Find an approved project decision</summary>
      <form
        className="workspace-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setHits(undefined);
          setSelected(undefined);
          try {
            setHits(
              (
                await workspaceRequest<{ hits: Hit[] }>(
                  sourceProject.trim()
                    ? "searchOtherDecisions"
                    : "searchApprovals",
                  {
                    query,
                    sourceProject: sourceProject.trim().toUpperCase(),
                  },
                )
              ).hits,
            );
          } catch (err) {
            setError(workspaceMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Source project key (optional)
          <input
            value={sourceProject}
            disabled={busy}
            placeholder="This project"
            onChange={(event) => setSourceProject(event.target.value)}
          />
        </label>
        <label>
          Words from the reviewer’s reason
          <input
            value={query}
            disabled={busy}
            maxLength={200}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={busy || !query.trim()}>
          Search approvals
        </Button>
      </form>
      {error && <p role="alert">{error}</p>}
      {hits?.length === 0 && (
        <p>No matching approvals among recent publications.</p>
      )}
      {!!hits?.length && (
        <ul className="workspace-records">
          {hits.map((hit) => (
            <li key={hit.publicationId}>
              <strong>{hit.title}</strong>
              {!hit.project && (
                <Button
                  variant="ghost"
                  onClick={() => onOpen(hit.publicationId)}
                >
                  Open receipt
                </Button>
              )}
              <Button
                size="small"
                onClick={() => {
                  setSelected(hit);
                  setDraftName("Reuse approved decision");
                }}
              >
                Reuse in this project
              </Button>
              <span>{hit.reason}</span>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <form
          className="workspace-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            const project = selected.project ?? runtime.projectId;
            const ticket = destination.trim().toUpperCase();
            const name = draftName.trim();
            const key = JSON.stringify([
              project,
              selected.publicationId,
              ticket,
              name,
            ]);
            if (reuseRequest.current?.key !== key)
              reuseRequest.current = { key, id: crypto.randomUUID() };
            try {
              const branch = await workspaceRequest<{ id: string }>(
                "reuseDecision",
                {
                  project,
                  ticket,
                  name,
                  publicationId: selected.publicationId,
                  requestId: reuseRequest.current.id,
                },
              );
              await onBranch(branch.id);
            } catch (err) {
              setError(workspaceMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Destination ticket
            <input
              required
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
            />
          </label>
          <label>
            Branch name
            <input
              required
              maxLength={100}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
            />
          </label>
          <Button
            type="submit"
            disabled={busy || !destination.trim() || !draftName.trim()}
          >
            Create draft from decision
          </Button>
        </form>
      )}
    </details>
  );
}

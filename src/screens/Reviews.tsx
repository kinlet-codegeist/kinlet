import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  GitBranch,
  GitCompare,
  GitPullRequest,
  Loader2,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
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
  SectionHeading,
  SourceChip,
  Tabs,
  TextField,
} from "../components/ui";
import { demoDelay } from "../data/gateway";
import {
  beginPublication,
  executeStep,
  fieldLabel,
  formatDate,
  isConflict,
} from "../domain/model";
import type { Resolution } from "../domain/types";

export function Reviews() {
  const { state } = useApp();
  const [tab, setTab] = useState("open");
  const proposals = state.proposals.filter(
    (p) =>
      tab === "all" ||
      (tab === "published"
        ? p.status === "published"
        : ["submitted", "publishing", "partial"].includes(p.status)),
  );
  return (
    <div className="page">
      <PageTitle
        title="Reviews"
        description="Compare proposed changes with their starting point and current Main."
      />
      <div className="listing-toolbar">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            {
              id: "open",
              label: "Needs review",
              count: state.proposals.filter(
                (p) => p.status === "submitted" || p.status === "partial",
              ).length,
            },
            { id: "published", label: "Published" },
            { id: "all", label: "All proposals" },
          ]}
        />

      </div>
      <div className="review-list">
        {proposals.map((p) => {
          const conflicts = p.changes.filter((c) =>
            isConflict(c, state.artifacts),
          ).length;
          const b = state.branches.find((b) => b.id === p.branchId);
          return (
            <Link
              className="card review-inbox-card"
              to={`/reviews/${p.id}`}
              key={p.id}
            >
              <div
                className={`review-inbox-icon ${conflicts && p.status === "submitted" ? "amber" : ""}`}
              >
                <GitPullRequest size={23} />
              </div>
              <div className="review-inbox-body">
                <div>
                  <h2>{p.title}</h2>
                  <Badge
                    tone={
                      p.status === "published"
                        ? "green"
                        : conflicts
                          ? "amber"
                          : "blue"
                    }
                  >
                    {p.status === "published"
                      ? "Published"
                      : p.status === "partial"
                        ? "Needs verification"
                        : conflicts
                          ? `${conflicts} conflicts`
                          : "Ready to review"}
                  </Badge>
                </div>
                <p>{p.summary}</p>
                <div className="review-meta">
                  <span>
                    <GitBranch size={13} />
                    {b?.name}
                  </span>
                  <span>
                    <LayersIcon />
                    {new Set(p.changes.map((c) => c.artifactId)).size} sources
                  </span>
                  <span>
                    <Clock3 size={13} />
                    {formatDate(p.createdAt)}
                  </span>
                </div>
              </div>
              <ChevronRight size={18} />
            </Link>
          );
        })}
        {!proposals.length ? (
          <div className="card">
            <EmptyState
              title="No proposals awaiting review"
              description="Submit a saved branch change to bring a proposal into this review inbox."
              icon="check"
              action={
                <Link className="button button-primary" to="/branches">
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
function LayersIcon() {
  return <GitCompare size={13} />;
}
export function ReviewDetail() {
  const { id } = useParams();
  const { state, act, notify, open } = useApp();
  const navigate = useNavigate();
  const p = state.proposals.find((p) => p.id === id);
  const [selected, setSelected] = useState<string[]>(
    p?.changes.map((c) => c.id) || [],
  );
  const [active, setActive] = useState(p?.changes[0]?.id || "");
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>(
    p?.resolutions || {},
  );
  const [custom, setCustom] = useState<string | null>(null);
  const [customText, setCustomText] = useState("");
  const [approve, setApprove] = useState(false);
  const [request, setRequest] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!p)
    return (
      <div className="page">
        <EmptyState
          title="Proposal not found"
          description="Choose an available proposal from Reviews."
          action={
            <Link className="button button-primary" to="/reviews">
              Open reviews
            </Link>
          }
        />
      </div>
    );
  const change = p.changes.find((c) => c.id === active) || p.changes[0];
  const artifact = state.artifacts[change.artifactId];
  const branch = state.branches.find((b) => b.id === p.branchId);
  const conflicts = p.changes.filter(
    (c) =>
      selected.includes(c.id) &&
      isConflict(c, state.artifacts) &&
      !resolutions[c.id],
  );
  const selectedCount = new Set(
    p.changes.filter((c) => selected.includes(c.id)).map((c) => c.artifactId),
  ).size;
  const resolved = resolutions[change.id];
  const blocked =
    state.flags.accessLost && p.changes.some((c) => c.artifactId === "policy");
  const resolve = (choice: Resolution["choice"], value: string) =>
    setResolutions((r) => ({ ...r, [change.id]: { choice, value } }));
  const adapt = async () => {
    if (state.flags.aiUnavailable) {
      notify(
        "Sample AI is unavailable. Resolve each difference manually.",
        "error",
      );
      return;
    }
    setBusy(true);
    await demoDelay(650);
    const next: Record<string, Resolution> = { ...resolutions };
    for (const c of p.changes.filter((c) => isConflict(c, state.artifacts))) {
      const live = state.artifacts[c.artifactId][c.field];
      next[c.id] = {
        choice: "custom",
        value:
          c.field === "description"
            ? `${live}\n\nImplementation note: verify guest purchases, preserve PayPal, and test payment recovery before release.`
            : live,
      };
    }
    setResolutions(next);
    setBusy(false);
    notify(
      "Sample suggestion prepared. Inspect the resolved values before publication.",
    );
  };
  const publish = () => {
    const pub = act((s) => beginPublication(s, p.id, selected, resolutions));
    if (pub) {
      setApprove(false);
      navigate(`/publications/${pub}?run=1`);
    }
  };
  if (p.status === "published")
    return (
      <div className="page">
        <Link className="back-link" to="/reviews">
          <ArrowLeft size={14} />
          All reviews
        </Link>
        <PageTitle
          title={p.title}
          description={p.summary}
        />
        <div className="card">
          <EmptyState
            title="Changes published"
            description="Open the receipt to see which sample records were updated."
            icon="check"
            action={
              <Link
                className="button button-primary"
                to={`/publications/${p.receiptId}`}
              >
                View publication receipt
                <ArrowRight size={14} />
              </Link>
            }
          />
        </div>
      </div>
    );
  return (
    <div className="page review-detail-page">
      <Link className="back-link" to="/reviews">
        <ArrowLeft size={14} />
        All reviews
      </Link>
      <PageTitle
        title={p.title}
        description={p.summary}
      />
      <div className="review-context-strip">
        <span>
          <GitBranch size={14} />
          {branch?.name}
        </span>
        <span>
          Base <Badge>{p.checkpointId}</Badge>
        </span>
        <ChevronRight size={13} />
        <span>
          Current Main <Badge tone="blue">{state.observedId}</Badge>
        </span>
        <span className="review-author">
          <Avatar size="small" />
          Your review
        </span>
      </div>
      {conflicts.length ? (
        <Notice tone="warning">
          <strong>
            {conflicts.length} selected conflict
            {conflicts.length === 1 ? "" : "s"} need your choice.
          </strong>{" "}
          The current sample source differs from both the starting point and the
          proposed value.
        </Notice>
      ) : (
        <Notice tone="success">
          <strong>
            {selected.length
              ? "Selected differences are resolved."
              : "No changes selected."}
          </strong>{" "}
          {selected.length
            ? "Inspect your selection before publishing to local Main."
            : "Choose the changes you want to review."}
        </Notice>
      )}
      <div className="review-layout">
        <div className="card review-diff-card">
          <div className="review-source-nav">
            <div className="small-heading">CHANGES TO REVIEW</div>
            {p.changes.map((c) => (
              <div
                className={`review-source-item ${c.id === change.id ? "active" : ""}`}
                key={c.id}
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${state.artifacts[c.artifactId].key}`}
                  checked={selected.includes(c.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, c.id]
                        : selected.filter((id) => id !== c.id),
                    )
                  }
                />
                <button onClick={() => setActive(c.id)}>
                  <ArtifactIcon
                    artifact={state.artifacts[c.artifactId]}
                    size={14}
                  />
                  <span>{state.artifacts[c.artifactId].key}</span>
                  {isConflict(c, state.artifacts) && !resolutions[c.id] ? (
                    <TriangleAlert size={13} />
                  ) : (
                    <Check size={13} />
                  )}
                </button>
              </div>
            ))}
          </div>
          <div className="diff-heading">
            <div>
              <ArtifactIcon artifact={artifact} />
              <strong>{artifact.key}</strong>
              <Badge>{fieldLabel(change.field)}</Badge>
            </div>
            <button
              className="text-link"
              onClick={() =>
                open({
                  type: "evidence",
                  artifactId: artifact.id,
                  checkpointId: p.checkpointId,
                })
              }
            >
              View captured source
              <ArrowRight size={12} />
            </button>
          </div>
          <div className="three-column review-diff-grid">
            <div className="diff-old">
              <div className="diff-column-label">
                <span className="tiny-dot" />
                STARTING POINT <strong>{p.checkpointId}</strong>
              </div>
              <p>{change.before}</p>
            </div>
            <div className={`diff-new ${resolved ? "resolved-diff" : ""}`}>
              <div className="diff-column-label">
                <span className="tiny-dot violet" />
                {resolved ? "RESOLVED VALUE" : "PROPOSED BRANCH"}
              </div>
              <p>{resolved?.value || change.after}</p>
            </div>
            <div className="diff-live">
              <div className="diff-column-label">
                <span className="tiny-dot blue" />
                CURRENT MAIN <strong>{state.observedId}</strong>
              </div>
              <p>{state.artifacts[change.artifactId][change.field]}</p>
            </div>
          </div>
          <div className="resolution-panel">
            <div>
              <strong>
                {resolved ? (
                  <>
                    <CheckCircle2 size={16} />
                    Your choice is recorded
                  </>
                ) : isConflict(change, state.artifacts) ? (
                  <>
                    <TriangleAlert size={16} />
                    Choose how this difference should be resolved
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    No conflicting change on this field
                  </>
                )}
              </strong>
              <p>
                {resolved
                  ? resolved.choice === "current"
                    ? "Keep the current native value. This may be an already-present result."
                    : resolved.choice === "custom"
                      ? "Use the edited value above."
                      : "Use the proposal value after your explicit review."
                  : "Your selection will appear in the publication preview."}
              </p>
            </div>
            <div className="resolution-buttons">
              <Button
                size="small"
                variant={
                  resolved?.choice === "current" ? "primary" : "secondary"
                }
                onClick={() =>
                  resolve(
                    "current",
                    state.artifacts[change.artifactId][change.field],
                  )
                }
              >
                Keep current
              </Button>
              <Button
                size="small"
                variant={
                  resolved?.choice === "proposal" ? "primary" : "secondary"
                }
                onClick={() => resolve("proposal", change.after)}
              >
                Use proposal
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setCustom(change.id);
                  setCustomText(
                    resolved?.value ||
                      state.artifacts[change.artifactId][change.field],
                  );
                }}
              >
                Edit resolution
              </Button>
            </div>
          </div>
          <div className="review-bottom-nav">
            <span>
              {p.changes.indexOf(change) + 1} of {p.changes.length} changes
            </span>
            {p.changes.indexOf(change) < p.changes.length - 1 ? (
              <Button
                size="small"
                onClick={() =>
                  setActive(p.changes[p.changes.indexOf(change) + 1].id)
                }
              >
                Next change
                <ArrowRight size={13} />
              </Button>
            ) : (
              <span className="saved-text">
                <Check size={13} />
                Every change is available above
              </span>
            )}
          </div>
        </div>
        <aside className="review-sidebar">
          <div className="card padded-card ai-review-card">
            <div className="row-heading">
              <span className="ai-orb">
                <Sparkles size={17} />
              </span>
              <h2>Review details</h2>
            </div>
            <Badge tone="violet">Sample AI suggestion</Badge>
            {state.flags.aiUnavailable ? (
              <Notice tone="warning">
                AI is unavailable in this scenario. The exact comparison and
                manual choices still work.
              </Notice>
            ) : (
              <>
                <p>
                  {p.checkpointId !== state.observedId
                    ? "The original work assumed customers would sign in. The current brief requires guest purchases. Preserve the payment and privacy constraints while adapting the approach."
                    : "This proposal adds a focused recovery behavior. Review the exact transaction and retry language before accepting it."}
                </p>
                <div className="ai-evidence">
                  {[...new Set(p.changes.map((c) => c.artifactId))].map((a) => (
                    <SourceChip key={a} id={a} compact />
                  ))}
                </div>
                {p.changes.some((c) => isConflict(c, state.artifacts)) ? (
                  <Button onClick={adapt} disabled={busy}>
                    <Sparkles size={14} />
                    {busy
                      ? "Preparing suggestion…"
                      : "Adapt sample to guest checkout"}
                  </Button>
                ) : null}
              </>
            )}
          </div>
          <div className="card padded-card review-approval-card">
            <SectionHeading
              title="Your review"
              action={<ShieldCheck size={17} />}
            />
            <dl className="detail-list">
              <div>
                <dt>Selected changes</dt>
                <dd>{selected.length}</dd>
              </div>
              <div>
                <dt>Sample records</dt>
                <dd>{selectedCount}</dd>
              </div>
              <div>
                <dt>Unresolved conflicts</dt>
                <dd className={conflicts.length ? "amber-text" : ""}>
                  {conflicts.length}
                </dd>
              </div>
            </dl>
            <p className="small muted">
              You choose what becomes part of Main. Earlier checkpoints are
              preserved.
            </p>
            <Button
              variant="primary"
              disabled={
                !!conflicts.length ||
                !selected.length ||
                blocked ||
                p.status === "changes_requested"
              }
              onClick={() => setApprove(true)}
            >
              <Check size={15} />
              Approve & publish
              <ArrowRight size={14} />
            </Button>
            <Button
              onClick={() => {
                act((s) => {
                  s.proposals.find((x) => x.id === p.id)!.resolutions =
                    resolutions;
                }, "Review choices saved locally.");
              }}
            >
              Save review for later
            </Button>
            <button className="subtle-link" onClick={() => setRequest(true)}>
              <MessageSquare size={13} />
              Request changes
            </button>
            <div className="approval-local-note">
              Local sample data only. No cloud writes.
            </div>
          </div>
        </aside>
      </div>
      {custom ? (
        <Dialog
          title="Edit the resolved value"
          subtitle="This value will appear in the publication preview."
          onClose={() => setCustom(null)}
          footer={
            <>
              <Button onClick={() => setCustom(null)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!customText.trim()}
                onClick={() => {
                  setResolutions((r) => ({
                    ...r,
                    [custom]: { choice: "custom", value: customText },
                  }));
                  setCustom(null);
                }}
              >
                Use this resolution
                <Check size={14} />
              </Button>
            </>
          }
          wide
        >
          <textarea
            aria-label="Resolved content"
            className="resolution-editor"
            rows={12}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
          />
        </Dialog>
      ) : null}
      {approve ? (
        <Dialog
          title="Confirm publication"
          subtitle="Confirm the changes to publish to the sample workspace."
          onClose={() => setApprove(false)}
          footer={
            <>
              <Button onClick={() => setApprove(false)}>Back to review</Button>
              <Button variant="primary" onClick={publish}>
                Publish {selectedCount} sample record
                {selectedCount === 1 ? "" : "s"}
                <ArrowRight size={14} />
              </Button>
            </>
          }
        >
          <div className="publication-preview">
            {p.changes
              .filter((c) => selected.includes(c.id))
              .map((c) => (
                <div key={c.id}>
                  <ArtifactIcon artifact={state.artifacts[c.artifactId]} />
                  <span>
                    <strong>{state.artifacts[c.artifactId].key}</strong>
                    <small>
                      {fieldLabel(c.field)} ·{" "}
                      {resolutions[c.id]?.choice === "current"
                        ? "Keep current value"
                        : "Apply reviewed value"}
                    </small>
                  </span>
                  <CheckCircle2 size={17} />
                </div>
              ))}
          </div>
          <Notice tone="info">
            This simulates Jira and Confluence updates in your browser. Saved
            checkpoints remain available. No real services are connected.
          </Notice>
        </Dialog>
      ) : null}
      {request ? (
        <Dialog
          title="Request changes"
          subtitle="The branch stays available for further work."
          onClose={() => setRequest(false)}
          footer={
            <>
              <Button onClick={() => setRequest(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!requestText.trim()}
                onClick={() => {
                  act((s) => {
                    const proposal = s.proposals.find((x) => x.id === p.id)!;
                    proposal.status = "changes_requested";
                    proposal.summary += `\nReviewer request: ${requestText}`;
                    const branch = s.branches.find(
                      (x) => x.id === proposal.branchId,
                    );
                    if (branch) branch.status = "open";
                  }, "Changes requested. The branch is open for editing.");
                  setRequest(false);
                  navigate(`/branches/${p.branchId}`);
                }}
              >
                Request changes
                <ArrowRight size={14} />
              </Button>
            </>
          }
        >
          <TextField label="What needs to change?">
            <textarea
              rows={5}
              value={requestText}
              onChange={(e) => setRequestText(e.target.value)}
              placeholder="Be specific about the outcome or missing evidence."
            />
          </TextField>
        </Dialog>
      ) : null}
    </div>
  );
}
export function PublicationReceipt() {
  const { id } = useParams();
  const { state, act } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const pub = state.publications.find((p) => p.id === id);
  const proposal = state.proposals.find((p) => p.id === pub?.proposalId);
  const [running, setRunning] = useState(false);
  const auto = params.get("run") === "1";
  useEffect(() => {
    if (!auto || !id || !pub || pub.status === "complete") return;
    let cancelled = false;
    const steps = pub.steps.length;
    void (async () => {
      setRunning(true);
      for (let i = 0; i < steps; i++) {
        await demoDelay(550);
        if (cancelled) return;
        const ok = act((s) => executeStep(s, id));
        if (!ok) break;
      }
      if (!cancelled) {
        setRunning(false);
        setParams({}, { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auto, id, act, setParams]);
  if (!pub || !proposal)
    return (
      <div className="page">
        <EmptyState
          title="Publication receipt not found"
          description="Open a published proposal to view its receipt."
          action={
            <Link className="button button-primary" to="/reviews">
              Open reviews
            </Link>
          }
        />
      </div>
    );
  const verified = pub.steps.filter((st) => st.status === "verified").length;
  const resume = async () => {
    setRunning(true);
    act((s) => {
      s.flags.partialPublish = false;
    });
    for (let i = 0; i < pub.steps.length; i++) {
      await demoDelay(500);
      const ok = act((s) => executeStep(s, pub.id));
      if (!ok) break;
    }
    setRunning(false);
  };
  return (
    <div className="page receipt-page">
      <Link className="back-link" to="/reviews">
        <ArrowLeft size={14} />
        All reviews
      </Link>
      <PageTitle
        title={
          pub.status === "complete"
            ? "Publication complete"
            : pub.status === "partial"
              ? "Publication interrupted"
              : "Publishing reviewed changes"
        }
        description={proposal.title}
      />
      <div className="card receipt-card">
        <div
          className={`receipt-symbol ${pub.status === "partial" ? "amber" : ""}`}
        >
          {pub.status === "complete" ? (
            <CheckCircle2 size={34} />
          ) : running ? (
            <Loader2 size={33} className="spin" />
          ) : (
            <TriangleAlert size={32} />
          )}
        </div>
        <h2>
          {pub.status === "complete"
            ? "Selected sample changes are published"
            : pub.status === "partial"
              ? "The remaining update needs verification"
              : "Publishing to local Main"}
        </h2>
        <p>
          {pub.status === "complete"
            ? "The selected changes were applied to the sample workspace."
            : `${verified} of ${pub.steps.length} sample records verified. We keep each outcome separate so a partial result never looks complete.`}
        </p>
        <div className="publication-progress">
          <span style={{ width: `${(verified / pub.steps.length) * 100}%` }} />
        </div>
        <div className="receipt-steps">
          {pub.steps.map((step, i) => (
            <div
              key={step.artifactId}
              className={`receipt-step ${step.status}`}
            >
              <span className="receipt-step-state">
                {step.status === "verified" ? (
                  <Check size={16} />
                ) : running && i === verified ? (
                  <Loader2 size={16} className="spin" />
                ) : step.status === "needs_verification" ? (
                  <TriangleAlert size={16} />
                ) : (
                  <span>{i + 1}</span>
                )}
              </span>
              <ArtifactIcon artifact={state.artifacts[step.artifactId]} />
              <div>
                <strong>{state.artifacts[step.artifactId].key}</strong>
                <p>
                  {step.error ||
                    step.changes.map((c) => fieldLabel(c.field)).join(", ")}
                </p>
              </div>
              <Badge
                tone={
                  step.status === "verified"
                    ? "green"
                    : step.status === "needs_verification"
                      ? "amber"
                      : "neutral"
                }
              >
                {step.status === "verified"
                  ? step.alreadyPresent
                    ? "Already present"
                    : "Verified"
                  : step.status === "needs_verification"
                    ? "Needs verification"
                    : "Pending"}
              </Badge>
            </div>
          ))}
        </div>
        {pub.status === "complete" ? (
          <div className="receipt-actions">
            <Link
              to={`/checkpoints/${pub.checkpointId}`}
              className="button button-primary"
            >
              Inspect checkpoint {pub.checkpointId}
              <ArrowRight size={14} />
            </Link>
            <Button onClick={() => navigate("/attention")}>
              Back to attention
            </Button>
          </div>
        ) : !running ? (
          <div className="receipt-actions">
            <Button variant="primary" onClick={resume}>
              <ShieldCheck size={15} />
              Verify & continue sample
            </Button>
            <Button onClick={() => navigate(`/reviews/${proposal.id}`)}>
              Return to review
            </Button>
          </div>
        ) : (
          <div role="status" className="muted small">
            Updating the selected sample records…
          </div>
        )}
        <div className="receipt-audit">
          <Avatar size="small" name={state.settings.reviewer} />
          <span>
            Reviewed by {state.settings.reviewer} · {formatDate(pub.createdAt)}
          </span>
          <Badge>Sample workspace</Badge>
        </div>
      </div>
      <Notice>
        Publishing a selected change does not automatically accept unrelated
        project edits. The last accepted baseline remains {state.approvedId}.
      </Notice>
    </div>
  );
}

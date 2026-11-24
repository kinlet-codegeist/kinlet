import { Link } from "react-router-dom";
import { DecisionForm, TicketDecisionHistory } from "./ReviewDecision";
import type { DecisionOutcome } from "../platform/review-decisions";
import { readTicket, sameText } from "../platform/jira-checkpoints";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "./ui";
import { TicketDraft } from "./TicketDraft";
import { PlanComparison } from "./PlanComparison";
import {
  applyTicketDraft,
  listPlanReviews,
  openPlanReview,
  recordPlanReview,
  type ReviewItem,
  type ReviewList,
} from "../platform/plan-reviews";

export function ReviewPanel({
  items,
  onOpen,
  action,
  empty,
  children,
}: {
  items: ReviewItem[];
  onOpen: (item: ReviewItem) => void;
  action?: ReactNode;
  empty?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className="card padded-card review-queue"
      aria-label="Needs review"
    >
      <div className="live-heading">
        <h2>Needs review</h2>
        {action}
      </div>
      {items.length > 0 && (
        <ul>
          {items.map((item) => (
            <li key={item.key}>
              <button onClick={() => onOpen(item)}>
                <span>
                  <strong>{item.key}</strong> {item.summary}
                  <small>
                    {item.planTitle} · v{item.baseline} → v{item.current}
                  </small>
                  {item.ticketExcerpt && (
                    <span className="review-excerpt">
                      Ticket wording ·{" "}
                      {item.ticketExcerpt.length > 155
                        ? item.ticketExcerpt.slice(0, 152) + "…"
                        : item.ticketExcerpt}
                    </span>
                  )}
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!items.length && empty && <p>{empty}</p>}
      {children}
    </section>
  );
}

export function NeedsReview({
  onReviewSaved,
  initialTicket,
}: {
  onReviewSaved: (issueId: string) => void;
  initialTicket?: string;
}) {
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<ReviewList | null>(null);
  const [opened, setOpened] = useState<ReviewItem | null>(null);
  const [notice, setNotice] = useState<{ key: string; version: number }>();
  const initial = useRef(initialTicket);
  const reconcile = useRef<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    setList(null);
    listPlanReviews(controller.signal, reconcile.current).then((result) => {
      if (!controller.signal.aborted) {
        setList(result);
        const item = result.items.find(({ key }) => key === initial.current);
        initial.current = undefined;
        if (item) setOpened(item);
      }
    });
    return () => controller.abort();
  }, [revision]);

  const refresh = () => {
    setOpened(null);
    setRevision((value) => value + 1);
  };
  useEffect(() => {
    // Returning from Jira while a comparison is open must keep the reviewed version on screen.
    const visible = () => {
      if (!opened && document.visibilityState === "visible")
        setRevision((value) => value + 1);
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [opened]);

  if (opened)
    return (
      <LiveReview
        key={opened.key + opened.checkpointId}
        item={opened}
        onBack={refresh}
        onRecorded={(issueId, version) => {
          reconcile.current = issueId;
          onReviewSaved(issueId);
          setNotice({ key: opened.key, version });
          refresh();
        }}
      />
    );

  const partial = !!list?.error || !!list?.unchecked.length;
  return (
    <ReviewPanel
      items={list?.items ?? []}
      onOpen={(item) => {
        setNotice(undefined);
        setOpened(item);
      }}
      action={
        <Button size="small" disabled={!list} onClick={refresh}>
          Refresh list
        </Button>
      }
      empty={
        list && !partial
          ? list.tracked
            ? "No linked plans need review."
            : "Save a checkpoint with a Confluence plan to track it here."
          : undefined
      }
    >
      {notice && (
        <p role="status">
          {notice.key} · Decision saved for plan v{notice.version}.{" "}
          <Link
            className="text-link"
            to={"/jira?ticket=" + encodeURIComponent(notice.key)}
          >
            View decision history
          </Link>
        </p>
      )}
      {!list && <p role="status">Checking linked plans…</p>}
      {list?.error && (
        <p role="alert">Couldn’t check the whole project. {list.error}</p>
      )}
      {!!list?.unchecked.length && (
        <p role="status">
          Couldn’t check {list.unchecked.join(", ")}. Check access to the
          ticket, its attachments, and the linked page, then refresh.
        </p>
      )}
    </ReviewPanel>
  );
}

function LiveReview({
  item,
  onBack,
  onRecorded,
}: {
  item: ReviewItem;
  onBack: () => void;
  onRecorded: (issueId: string, version: number) => void;
}) {
  const [detail, setDetail] =
    useState<Awaited<ReturnType<typeof openPlanReview>>>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [applied, setApplied] = useState("");
  const [outcome, setOutcome] = useState<DecisionOutcome | "">("");
  const [reason, setReason] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const pending = useRef<{ fingerprint: string; id: string } | undefined>(
    undefined,
  );
  const submitting = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    let valid = true;
    openPlanReview(item)
      .then((result) => {
        if (valid) setDetail(result);
      })
      .catch((err) => {
        if (valid)
          setError(
            err instanceof Error
              ? err.message
              : "Couldn’t load the comparison.",
          );
      });
    return () => {
      valid = false;
      active.current = false;
    };
  }, [item]);
  async function saveDecision() {
    if (!detail || !outcome || !reason.trim() || submitting.current) return;
    submitting.current = true;
    const displayedVersion = detail.versions.current.version;
    setSaving(true);
    setError("");
    try {
      const input = { outcome, reason: reason.trim() };
      const fingerprint = JSON.stringify([
        input,
        detail.versions.saved.version,
        displayedVersion,
        detail.ticket.summary,
        detail.ticket.description,
      ]);
      if (pending.current?.fingerprint !== fingerprint)
        pending.current = { fingerprint, id: crypto.randomUUID() };
      const id = await recordPlanReview(
        item,
        detail,
        input,
        pending.current.id,
      );
      if (active.current) onRecorded(id, displayedVersion);
    } catch (err) {
      if (active.current)
        setError(
          err instanceof Error
            ? err.message
            : "Couldn’t save the decision. Try again.",
        );
    } finally {
      submitting.current = false;
      if (active.current) setSaving(false);
    }
  }
  async function refreshWording() {
    if (!detail) return;
    setRefreshing(true);
    setError("");
    try {
      const ticket = await readTicket(item.key);
      if (!active.current) return;
      if (ticket.id !== detail.ticket.id)
        throw new Error("The ticket changed. Reopen the review.");
      if (!sameText(ticket, detail.ticket)) setOutcome("");
      setDetail({ ...detail, ticket });
      setApplied("Current ticket wording loaded.");
    } catch (err) {
      if (active.current)
        setError(
          err instanceof Error ? err.message : "Couldn’t refresh the ticket.",
        );
    } finally {
      if (active.current) setRefreshing(false);
    }
  }
  return (
    <section
      className="card padded-card review-queue"
      aria-label="Review linked plan"
    >
      <div className="live-heading">
        <h2>Review {item.key}</h2>
        <Button disabled={saving || refreshing} size="small" onClick={onBack}>
          Back to list
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {detail === undefined && !error && (
        <p role="status">Loading the ticket and plan versions…</p>
      )}
      {detail === null && <p>This plan is already up to date.</p>}
      {detail && (
        <>
          <PlanComparison
            versions={detail.versions}
            ticket={detail.ticket}
            issueKey={item.key}
            baselineIsReview={detail.baselineIsReview}
          />
          {editing ? (
            <TicketDraft
              versions={detail.versions}
              doc={detail.ticket.descriptionDoc}
              issueKey={item.key}
              saving={saving}
              onCancel={() => setEditing(false)}
              onApply={async (passage, wording) => {
                if (saving) return;
                setSaving(true);
                try {
                  const ticket = await applyTicketDraft(
                    item,
                    detail,
                    passage,
                    wording,
                  );
                  if (active.current) {
                    setDetail({ ...detail, ticket });
                    setApplied("Description updated on " + ticket.key + ".");
                    setOutcome("updated");
                    setEditing(false);
                  }
                } finally {
                  if (active.current) setSaving(false);
                }
              }}
            />
          ) : (
            <>
              {applied && <p role="status">{applied}</p>}
              <div className="live-heading-actions">
                <Button
                  variant="primary"
                  disabled={saving || refreshing}
                  onClick={() => {
                    setApplied("");
                    setEditing(true);
                  }}
                >
                  Draft ticket update
                </Button>

                <Button
                  onClick={async () => {
                    try {
                      const { router } = await import("@forge/bridge");
                      await router.open(
                        "/browse/" + encodeURIComponent(item.key),
                      );
                    } catch {
                      if (active.current)
                        setError(
                          "Couldn’t open the ticket. Find it in Jira using its key.",
                        );
                    }
                  }}
                >
                  Open ticket in Jira
                </Button>
              </div>
              <DecisionForm
                version={detail.versions.current.version}
                outcome={outcome}
                reason={reason}
                setOutcome={setOutcome}
                setReason={setReason}
                disabled={saving || refreshing}
                saving={saving}
                onSave={saveDecision}
              />
              <Button
                size="small"
                disabled={saving || refreshing}
                onClick={refreshWording}
              >
                {refreshing ? "Refreshing…" : "Refresh ticket wording"}
              </Button>
              <TicketDecisionHistory
                ticket={detail.ticket}
                onTicketUpdated={(ticket) => {
                  setDetail({ ...detail, ticket });
                  setApplied("Returned edit applied to " + ticket.key + ".");
                  setOutcome("updated");
                }}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}

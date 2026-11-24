import { useEffect, useMemo, useRef, useState } from "react";
import {
  branchField,
  ticketFields,
  type BranchReview,
  type TicketField,
} from "../platform/branch-publication";
import type { BranchRevision, BranchStore } from "../platform/ticket-branches";
import { Button, Dialog } from "./ui";

const names = { summary: "Summary", description: "Description" };
const statuses = {
  unchanged: "The checkpoint, draft and ticket match.",
  ticketOnly: "Only the ticket changed. Its current wording will be kept.",
  matches: "The ticket already contains this draft wording.",
  formatted:
    "This edit would replace formatted content. Edit this passage in Jira to preserve its formatting.",
  ready: "The ticket still matches the checkpoint.",
  conflict: "Both the ticket and the branch changed since the checkpoint.",
};

export function BranchPublication({
  store,
  revision,
  ticketKey,
  sample,
  onClose,
  backLabel = "Back to branch",
  onHistory,
  inboxAction,
}: {
  store: BranchStore;
  revision: BranchRevision;
  ticketKey: string;
  sample: boolean;
  onClose: () => void;
  backLabel?: string;
  onHistory: () => void;
  inboxAction?: { label: string; open: (review: BranchReview) => void };
}) {
  const [review, setReview] = useState<BranchReview>();
  const [selected, setSelected] = useState<TicketField[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [attemptedApply, setAttemptedApply] = useState(false);
  const writing = useRef(false);
  useEffect(() => {
    let active = true;
    store.review(revision).then(
      (fresh) => {
        if (active) setReview(fresh);
      },
      (err) => {
        if (active)
          setError(
            err instanceof Error ? err.message : "Couldn’t load this review.",
          );
      },
    );
    return () => {
      active = false;
    };
  }, [store, revision, attempt]);
  const rows = useMemo(
    () =>
      review &&
      ticketFields.map((field) => ({ field, ...branchField(review, field) })),
    [review],
  );
  const destination = sample ? "sample ticket" : ticketKey;

  function refresh() {
    setAttemptedApply(false);
    setSelected([]);
    setReview(undefined);
    setResult(undefined);
    setError("");
    setAttempt((value) => value + 1);
  }
  async function apply() {
    if (!review || !selected.length || writing.current) return;
    writing.current = true;
    setAttemptedApply(true);
    setBusy(true);
    try {
      const written = await store.apply(review, selected);
      setResult(
        written.length
          ? "Updated the " +
              written.join(" and ") +
              " on " +
              (sample ? "the sample ticket." : ticketKey + ".")
          : "The ticket already contains all the selected wording.",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn’t confirm the update. Refresh the review to check the ticket.",
      );
      setSelected([]);
      setReview(undefined);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Review branch changes"
      subtitle={
        ticketKey +
        " · " +
        revision.name +
        " · Revision " +
        revision.revisionId.slice(0, 8) +
        (sample ? " · Sample ticket" : "")
      }
      wide
      onClose={() => {
        if (!writing.current) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            {result ? "Done" : backLabel}
          </Button>
          {(result || (attemptedApply && error)) && (
            <Button onClick={onHistory}>View publication history</Button>
          )}
          {inboxAction &&
            review &&
            !result &&
            rows?.some((row) =>
              ["ready", "conflict", "formatted"].includes(row.status),
            ) && (
              <Button disabled={busy} onClick={() => inboxAction.open(review)}>
                {inboxAction.label}
              </Button>
            )}
          {review && !result && (
            <Button
              variant="primary"
              disabled={busy || !selected.length}
              onClick={() => void apply()}
            >
              {busy ? "Applying changes…" : "Apply to " + destination}
            </Button>
          )}
        </>
      }
    >
      {result ? (
        <p role="status">{result}</p>
      ) : error ? (
        <div className="ticket-branches">
          <p role="alert">{error}</p>
          <Button onClick={refresh}>Refresh review</Button>
        </div>
      ) : !review ? (
        <p role="status">Reading the checkpoint, branch and ticket…</p>
      ) : (
        <div className="branch-publication">
          <p>
            Choose which draft fields to apply to{" "}
            {sample ? "the sample ticket" : ticketKey}.
          </p>
          <p className="review-note">
            Checkpoint #{revision.checkpointId} · Draft saved by{" "}
            {revision.author}
            {review.base.plan &&
              " · Plan v" + review.base.plan.version + " at checkpoint"}
          </p>
          {rows?.map(({ field, status, update }) => (
            <section key={field}>
              <h3>{names[field]}</h3>
              <p
                className={
                  status === "conflict" ? "handoff-plan-change" : undefined
                }
              >
                {status === "formatted" &&
                  review.live[field] !== review.base[field] &&
                  "Both the ticket and the branch changed. "}
                {statuses[status]}
              </p>
              <details open={!!update || status === "formatted" || undefined}>
                <summary>Compare {field} wording</summary>
                <div className="proposal-passages">
                  <section>
                    <h4>Checkpoint</h4>
                    <p>{review.base[field] || "(Empty)"}</p>
                  </section>
                  <section>
                    <h4>Current ticket</h4>
                    <p>{review.live[field] || "(Empty)"}</p>
                  </section>
                  <section>
                    <h4>Saved draft</h4>
                    <p>{review.revision[field] || "(Empty)"}</p>
                  </section>
                </div>
              </details>
              {update && (
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(field)}
                    disabled={busy}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, field]
                          : selected.filter((item) => item !== field),
                      )
                    }
                  />
                  {status === "conflict"
                    ? "Replace the current " + field + " with this draft"
                    : "Apply draft " + field}
                </label>
              )}
            </section>
          ))}
          <Button size="small" disabled={busy} onClick={refresh}>
            Refresh review
          </Button>
        </div>
      )}
    </Dialog>
  );
}

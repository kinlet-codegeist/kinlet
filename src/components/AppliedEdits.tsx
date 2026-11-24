import { useEffect, useState } from "react";
import { readAppliedEdits, type AppliedEdit } from "../platform/applied-edits";
import type { HandoffSource } from "../platform/decision-handoff";
import type { DecisionEntry } from "../platform/review-decisions";
import { Button, Dialog } from "./ui";

export function AppliedEdits({
  source,
  entry,
  onClose,
}: {
  source: HandoffSource;
  entry: DecisionEntry;
  onClose: () => void;
}) {
  const [result, setResult] = useState<{
    edits: AppliedEdit[];
    incomplete: number;
  }>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const { kind, key } = source;
  const reviewId = entry.id;
  useEffect(() => {
    if (kind === "sample") return;
    const controller = new AbortController();
    readAppliedEdits(key, reviewId, controller.signal).then(
      (found) => {
        if (!controller.signal.aborted) setResult(found);
      },
      (err) => {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error
              ? err.message
              : "Couldn’t load Jira’s ticket history.",
          );
      },
    );
    return () => controller.abort();
  }, [kind, key, reviewId, attempt]);

  const edits =
    source.kind === "sample"
      ? source.appliedEdits.filter((edit) => edit.reviewId === entry.id)
      : result?.edits;
  return (
    <Dialog
      title="Applied edits"
      wide
      onClose={onClose}
      subtitle={
        key +
        " · Decision for plan v" +
        entry.version +
        (kind === "sample" ? " · Sample ticket" : "")
      }
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {error ? (
        <div className="applied-edits">
          <p role="alert">{error}</p>
          <Button
            onClick={() => {
              setError("");
              setAttempt((v) => v + 1);
            }}
          >
            Try again
          </Button>
        </div>
      ) : !edits ? (
        <p role="status">Reading the ticket’s change history…</p>
      ) : (
        <>
          {edits.length > 0 ? (
            <ol
              className="applied-edits"
              aria-label="Returned edits, newest first"
            >
              {edits.map((edit) => (
                <li key={edit.id}>
                  <h3>
                    {edit.review
                      ? "Reviewed proposal"
                      : !edit.original
                        ? "Added to the description"
                        : !edit.replacement
                          ? "Removed from the description"
                          : "Reworded a passage"}
                  </h3>
                  <p className="decision-attribution">
                    {edit.author} ·{" "}
                    <time dateTime={edit.created}>
                      {new Date(edit.created).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>{" "}
                    · Used plan v{edit.planVersion}
                  </p>
                  {edit.review ? (
                    <>
                      <p>
                        Handoff used plan v{edit.review.proposalPlanVersion}.
                        Review used plan v{edit.planVersion}.
                      </p>
                      <div>
                        <h4>Reviewer’s reason</h4>
                        <p>{edit.review.reason}</p>
                        {entry.decision?.reason && (
                          <p className="decision-attribution">
                            Original decision · {entry.decision.reason}
                          </p>
                        )}
                      </div>
                      {edit.review.changes.map((change, index) => (
                        <div className="reviewed-passage" key={index}>
                          <h4>
                            {edit.review?.kept.includes(index)
                              ? "Kept edit "
                              : "Skipped edit "}
                            {index + 1}
                          </h4>
                          <RecordedPassage {...change} />
                        </div>
                      ))}
                    </>
                  ) : (
                    <RecordedPassage {...edit} />
                  )}
                </li>
              ))}
            </ol>
          ) : (
            !result?.incomplete && (
              <p>No returned edits are recorded for this decision.</p>
            )
          )}
          {!!result?.incomplete && (
            <p role="status">
              Some linked changes have incomplete Jira records.
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}

function RecordedPassage({
  original,
  replacement,
  reason,
}: Pick<AppliedEdit, "original" | "replacement" | "reason">) {
  return (
    <>
      <div className="proposal-passages">
        {original && (
          <section>
            <h4>Before</h4>
            <p>{original}</p>
          </section>
        )}
        {replacement && (
          <section>
            <h4>After</h4>
            <p>{replacement}</p>
          </section>
        )}
      </div>
      {reason && (
        <div>
          <h4>Reason supplied with the edit</h4>
          <p>{reason}</p>
        </div>
      )}
    </>
  );
}

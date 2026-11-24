import { useEffect, useState } from "react";
import { ticketFields } from "../platform/branch-publication";
import type { PublicationHistory } from "../platform/branch-receipts";
import type { BranchRevision, BranchStore } from "../platform/ticket-branches";
import { Button, Dialog } from "./ui";

export function BranchPublicationHistory({
  store,
  revision,
  ticketKey,
  sample,
  onClose,
  backLabel = "Back to branch",
  onReview,
}: {
  store: BranchStore;
  revision: BranchRevision;
  ticketKey: string;
  sample: boolean;
  onClose: () => void;
  backLabel?: string;
  onReview: () => void;
}) {
  const [history, setHistory] = useState<PublicationHistory>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    store.publicationHistory(revision, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setHistory(result);
      },
      (err) => {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error
              ? err.message
              : "Couldn’t read the publication history.",
          );
      },
    );
    return () => controller.abort();
  }, [store, revision, attempt]);
  function refresh() {
    setHistory(undefined);
    setError("");
    setAttempt((n) => n + 1);
  }
  const changed = ticketFields.filter(
    (field) =>
      history && history.review.base[field] !== history.review.revision[field],
  );
  const applied = new Set(
    history?.receipts.flatMap((receipt) =>
      receipt.changes.map((item) => item.field),
    ),
  );
  const hasDifferences =
    history &&
    changed.some(
      (field) => history.review.live[field] !== history.review.revision[field],
    );
  return (
    <Dialog
      title="Publication history"
      wide
      subtitle={
        ticketKey +
        " · " +
        revision.name +
        " · Revision " +
        revision.revisionId.slice(0, 8) +
        (sample ? " · Sample ticket" : "")
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{backLabel}</Button>
          {hasDifferences && (
            <Button variant="primary" onClick={onReview}>
              Review current differences
            </Button>
          )}
        </>
      }
    >
      {error ? (
        <div className="ticket-branches">
          <p role="alert">{error}</p>
          <Button onClick={refresh}>Try again</Button>
        </div>
      ) : !history ? (
        <p role="status">Reading the ticket and its change history…</p>
      ) : (
        <div className="branch-publication">
          <section>
            <h3>Fields changed in this draft</h3>
            {changed.length ? (
              <table
                className="branch-receipt-fields"
                aria-label="Publication and current wording by field"
              >
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Publication</th>
                    <th scope="col">Current ticket</th>
                  </tr>
                </thead>
                <tbody>
                  {changed.map((field) => (
                    <tr key={field}>
                      <th scope="row">
                        {field === "summary" ? "Summary" : "Description"}
                      </th>
                      <td>
                        {applied.has(field)
                          ? "Applied from this revision"
                          : history.incomplete
                            ? "Unconfirmed"
                            : "No linked change"}
                      </td>
                      <td>
                        {history.review.live[field] ===
                        history.review.revision[field]
                          ? "Matches draft"
                          : "Differs from draft"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>This revision matches the source checkpoint.</p>
            )}
          </section>
          <section>
            <h3>Recorded changes</h3>
            {!history.receipts.length && !history.incomplete && (
              <p>No ticket changes are linked to this revision.</p>
            )}
            {history.incomplete > 0 && (
              <p role="status">
                Some linked records have incomplete change details.
              </p>
            )}
            {history.receipts.length > 0 && (
              <ol
                className="applied-edits"
                aria-label="Publications, newest first"
              >
                {history.receipts.map((receipt) => (
                  <li key={receipt.id}>
                    <strong>
                      Applied{" "}
                      {receipt.changes.map((item) => item.field).join(" and ")}
                    </strong>
                    <p className="decision-attribution">
                      {receipt.author} ·{" "}
                      <time dateTime={receipt.created}>
                        {new Date(receipt.created).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </time>
                      {!sample && " · Jira change #" + receipt.id}
                    </p>
                    {receipt.changes.map((item) => (
                      <details key={item.field}>
                        <summary>Recorded {item.field} wording</summary>
                        {item.before === null && item.after === null ? (
                          <p>
                            Jira did not include the wording for this change.
                          </p>
                        ) : (
                          <div className="proposal-passages">
                            <section>
                              <h4>Before</h4>
                              <p>
                                {item.before === null
                                  ? "Earlier wording unavailable."
                                  : item.before || "(Empty)"}
                              </p>
                            </section>
                            <section>
                              <h4>After</h4>
                              <p>
                                {item.after === null
                                  ? "Applied wording unavailable."
                                  : item.after || "(Empty)"}
                              </p>
                            </section>
                          </div>
                        )}
                      </details>
                    ))}
                  </li>
                ))}
              </ol>
            )}
          </section>
          <Button size="small" onClick={refresh}>
            Refresh history
          </Button>
        </div>
      )}
    </Dialog>
  );
}

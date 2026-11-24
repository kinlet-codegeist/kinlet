import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { decisionLabels } from "../domain/decision-search";
import { Button } from "./ui";
import { ReturnedProposal } from "./ReturnedProposal";
import { DecisionHandoff } from "./DecisionHandoff";
import { AppliedEdits } from "./AppliedEdits";
import type { HandoffSource } from "../platform/decision-handoff";
import {
  maxReasonLength,
  ticketDecisions,
  type DecisionEntry,
  type DecisionHistory,
  type DecisionOutcome,
} from "../platform/review-decisions";
import type { IndexedTicket, Ticket } from "../platform/jira-checkpoints";

export function DecisionForm({
  version,
  outcome,
  reason,
  setOutcome,
  setReason,
  disabled,
  saving,
  sample,
  onSave,
}: {
  version: number;
  outcome: DecisionOutcome | "";
  reason: string;
  setOutcome: (value: DecisionOutcome) => void;
  setReason: (value: string) => void;
  disabled?: boolean;
  saving?: boolean;
  sample?: boolean;
  onSave: () => void;
}) {
  const name = useId();
  return (
    <form
      className="review-decision-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (outcome && reason.trim() && !disabled) onSave();
      }}
    >
      <fieldset disabled={disabled}>
        <legend>Review decision</legend>
        <div className="decision-choices">
          <label>
            <input
              type="radio"
              required
              name={name}
              checked={outcome === "kept"}
              onChange={() => setOutcome("kept")}
            />
            {decisionLabels.kept}
          </label>
          <label>
            <input
              type="radio"
              required
              name={name}
              checked={outcome === "updated"}
              onChange={() => setOutcome("updated")}
            />
            {decisionLabels.updated}
          </label>
        </div>
        <label className="decision-reason">
          Why did you make this decision?
          <textarea
            required
            rows={2}
            maxLength={maxReasonLength}
            value={reason}
            placeholder={
              sample
                ? "For example, guest payments aren’t ready for the beta."
                : undefined
            }
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <p className="review-note">
          {sample
            ? "Your reason will appear in the sample ticket’s history."
            : "Your decision and reason are saved in a Jira ticket attachment."}
        </p>
        <Button
          type="submit"
          variant="primary"
          disabled={disabled || !outcome || !reason.trim()}
        >
          {saving ? "Saving decision…" : "Save decision for v" + version}
        </Button>
      </fieldset>
    </form>
  );
}

export function DecisionRow({
  entry,
  pageLabel,
  source,
  wordingMatched,
  handoffSource,
  selected,
}: {
  entry: DecisionEntry;
  pageLabel?: string;
  source?: ReactNode;
  wordingMatched?: boolean;
  handoffSource: HandoffSource;
  selected?: boolean;
}) {
  const [dialog, setDialog] = useState<"handoff" | "return" | "edits" | null>(
    null,
  );
  const { decision } = entry;
  const date = new Date(entry.created);
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) row.current?.focus();
  }, [selected]);
  return (
    <li
      ref={row}
      tabIndex={selected ? -1 : undefined}
      className={selected ? "selected-decision" : undefined}
    >
      {source && <div className="decision-source">{source}</div>}
      <strong>
        {decision ? decisionLabels[decision.outcome] : "Marked reviewed"}
      </strong>
      <div className="decision-attribution">
        {entry.author} · {pageLabel ?? "Confluence page " + entry.pageId}
        {" · "}
        {decision
          ? "v" + decision.fromVersion + " → v" + entry.version
          : "v" + entry.version}
        {Number.isFinite(date.getTime()) && (
          <>
            {" "}
            ·{" "}
            <time dateTime={date.toISOString()}>
              {date.toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          </>
        )}
      </div>
      {decision ? (
        <>
          <p className="decision-rationale">{decision.reason}</p>
          <details>
            <summary>
              {wordingMatched
                ? "Matched in the saved ticket wording"
                : "Ticket wording at the time"}
            </summary>
            <strong>{decision.wording.summary}</strong>
            <p className="plan-wording">
              {decision.wording.description || "No description"}
            </p>
          </details>
        </>
      ) : (
        <p className="review-note">
          This earlier review has no recorded decision or reason.
        </p>
      )}
      <Button
        size="small"
        className="prepare-decision-handoff"
        onClick={() => setDialog("handoff")}
      >
        Prepare handoff
      </Button>
      <Button
        size="small"
        className="prepare-decision-handoff"
        onClick={() => setDialog("return")}
      >
        Review returned edit
      </Button>
      <Button
        size="small"
        className="prepare-decision-handoff"
        onClick={() => setDialog("edits")}
      >
        Applied edits
      </Button>
      {dialog === "edits" && (
        <AppliedEdits
          source={handoffSource}
          entry={entry}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "return" && (
        <ReturnedProposal
          source={handoffSource}
          entry={entry}
          onClose={() => setDialog(null)}
          onPrepare={() => setDialog("handoff")}
        />
      )}
      {dialog === "handoff" && (
        <DecisionHandoff
          source={handoffSource}
          entry={entry}
          onClose={() => setDialog(null)}
        />
      )}
    </li>
  );
}

export function DecisionTimeline({
  history,
  handoffSource,
  pageLabel,
  selectedId,
}: {
  history: DecisionHistory | null;
  handoffSource: HandoffSource;
  pageLabel?: string;
  selectedId?: string;
}) {
  return (
    <section className="ticket-decisions" aria-label="Decision history">
      <h3>Decision history</h3>
      {!history ? (
        <p role="status">Loading decisions…</p>
      ) : (
        <>
          {selectedId &&
            !history.entries.some((entry) => entry.id === selectedId) && (
              <p role="status">
                The selected decision is unavailable. The records below are the
                reviews you can currently read.
              </p>
            )}
          {!history.entries.length && !history.unavailable && (
            <p>No decisions recorded for this ticket yet.</p>
          )}
          {history.entries.length > 0 && (
            <ol>
              {history.entries.slice(0, 3).map((entry) => (
                <DecisionRow
                  key={entry.id}
                  entry={entry}
                  pageLabel={pageLabel}
                  handoffSource={handoffSource}
                  selected={selectedId === entry.id}
                />
              ))}
            </ol>
          )}
          {history.entries.length > 3 && (
            <details
              open={
                history.entries
                  .slice(3)
                  .some((entry) => entry.id === selectedId) || undefined
              }
            >
              <summary>
                Earlier decisions ({history.entries.length - 3})
              </summary>
              <ol start={4}>
                {history.entries.slice(3).map((entry) => (
                  <DecisionRow
                    key={entry.id}
                    entry={entry}
                    pageLabel={pageLabel}
                    handoffSource={handoffSource}
                    selected={selectedId === entry.id}
                  />
                ))}
              </ol>
            </details>
          )}
          {history.unavailable > 0 && (
            <p role="status">
              {history.unavailable === 1
                ? "One review record couldn’t be loaded."
                : history.unavailable + " review records couldn’t be loaded."}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function TicketDecisionHistory({
  ticket,
  selectedId,
  onTicketUpdated,
}: {
  ticket: IndexedTicket;
  selectedId?: string;
  onTicketUpdated?: (ticket: Ticket) => void;
}) {
  const [loaded, setLoaded] = useState<{
    ticket: IndexedTicket;
    history: DecisionHistory;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    ticketDecisions(ticket, controller.signal).then((history) => {
      if (!controller.signal.aborted) setLoaded({ ticket, history });
    });
    return () => controller.abort();
  }, [ticket]);
  return (
    <DecisionTimeline
      history={loaded?.ticket === ticket ? loaded.history : null}
      handoffSource={{ kind: "jira", key: ticket.key, onTicketUpdated }}
      selectedId={selectedId}
    />
  );
}

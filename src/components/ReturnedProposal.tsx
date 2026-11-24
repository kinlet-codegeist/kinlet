import { useEffect, useMemo, useRef, useState } from "react";
import { plainText } from "../platform/atlassian-text";
import type {
  HandoffSource,
  SampleHandoffSource,
} from "../platform/decision-handoff";
import type { Ticket } from "../platform/jira-checkpoints";
import type { DecisionEntry } from "../platform/review-decisions";
import {
  applyReturnedProposal,
  inspectReturnedProposal,
  parseReturnedProposal,
  selectedProposalDocument,
  type ProposalSelection,
  type ProposalPreview,
  type ReturnedProposal as Proposal,
} from "../platform/returned-proposal";
import { Button, Dialog } from "./ui";
import { AppliedEdits } from "./AppliedEdits";
import {
  maxReviewReason,
  type PassageEdit,
} from "../platform/returned-passages";

export function sampleResponse(
  source: SampleHandoffSource,
  entry: DecisionEntry,
  mixed = false,
) {
  const retry = {
    original: "",
    replacement:
      "Verify that a failed PayPal payment lets the customer retry without creating a second order.",
    reason:
      "The checkout ticket needs an acceptance check for a failed payment.",
  };
  return JSON.stringify(
    {
      format: "kinlet.decision-handoff.v1",
      source: "sample",
      ticket: {
        key: source.key,
        current: entry.decision?.wording ?? source.ticket,
      },
      review: { id: entry.id, checkpointId: entry.checkpointId },
      plan: {
        pageId: entry.pageId,
        reviewedVersion: entry.version,
        current: { version: entry.version },
      },
      proposal: mixed
        ? {
            changes: [
              {
                original: "",
                replacement:
                  "Require shoppers to sign in before retrying a failed payment.",
                reason: "The checkout plan required an account before payment.",
              },
              retry,
            ],
          }
        : retry,
    },
    null,
    2,
  );
}

export function ReturnedProposal({
  source,
  entry,
  onClose,
  onPrepare,
  initialInput = "",
}: {
  source: HandoffSource;
  entry: DecisionEntry;
  onClose: () => void;
  onPrepare?: () => void;
  initialInput?: string;
}) {
  const [input, setInput] = useState(initialInput);
  const [selection, setSelection] = useState<ProposalSelection>({
    kept: [],
    reason: "",
  });
  const [review, setReview] = useState<{
    proposal: Proposal;
    preview: ProposalPreview;
  }>();
  const preview = review?.preview;
  const kept = selection.kept;
  const selected = useMemo(() => {
    if (!preview?.needsSelection) return { doc: preview?.expected };
    try {
      return { doc: selectedProposalDocument(preview, { kept, reason: "" }) };
    } catch (err) {
      return {
        error:
          err instanceof Error ? err.message : "Couldn’t preview these edits.",
      };
    }
  }, [preview, kept]);
  const [busy, setBusy] = useState<"read" | "apply" | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [showEdits, setShowEdits] = useState(false);
  const confirmed = useRef<Ticket | null>(null);
  const operation = useRef(0);
  const writing = useRef(false);
  useEffect(
    () => () => {
      operation.current++;
    },
    [],
  );
  function close() {
    if (writing.current) return;
    onClose();
    if (source.kind === "jira" && confirmed.current)
      source.onTicketUpdated?.(confirmed.current);
  }
  function edit(value: string) {
    operation.current++;
    setInput(value);
    setReview(undefined);
    setBusy(null);
    setError("");
  }
  async function openFile(file: File) {
    const id = ++operation.current;
    setReview(undefined);
    setInput("");
    setBusy("read");
    setError("");
    try {
      const raw = await file.text();
      if (id === operation.current) setInput(raw);
    } catch {
      if (id === operation.current)
        setError("Couldn’t open this file. Paste the JSON instead.");
    } finally {
      if (id === operation.current) setBusy(null);
    }
  }
  async function inspect() {
    const id = ++operation.current;
    setSelection({ kept: [], reason: "" });
    setBusy("read");
    setError("");
    setReview(undefined);
    try {
      const proposal = parseReturnedProposal(input);
      const preview = await inspectReturnedProposal(source, entry, proposal);
      if (id === operation.current) setReview({ proposal, preview });
    } catch (err) {
      if (id === operation.current)
        setError(
          err instanceof Error ? err.message : "Couldn’t check the proposal.",
        );
    } finally {
      if (id === operation.current) setBusy(null);
    }
  }
  async function apply() {
    if (!review || !selected.doc || writing.current || saved) return;
    writing.current = true;
    const id = ++operation.current;
    setBusy("apply");
    setError("");
    try {
      const ticket = await applyReturnedProposal(
        source,
        entry,
        review.proposal,
        review.preview,
        review.preview.needsSelection ? selection : undefined,
      );
      if (id === operation.current) {
        confirmed.current = ticket;
        setSaved(true);
      }
    } catch (err) {
      if (id === operation.current) {
        setReview(undefined);
        setError(
          err instanceof Error
            ? err.message
            : "Couldn’t confirm the update. Check the proposal again.",
        );
      }
    } finally {
      writing.current = false;
      if (id === operation.current) setBusy(null);
    }
  }
  const current = preview?.context.evidence.ticket.current;
  const canSelectEdits =
    preview?.needsSelection &&
    preview.choices.some((choice) => !choice.problem);
  const canApply =
    !!selected.doc && (!preview?.needsSelection || !!selection.reason.trim());
  if (showEdits)
    return <AppliedEdits source={source} entry={entry} onClose={close} />;
  return (
    <Dialog
      title="Review returned edit"
      subtitle={
        source.key +
        " · Decision for plan v" +
        entry.version +
        (source.kind === "sample" ? " · Sample ticket" : "")
      }
      wide
      onClose={close}
      footer={
        saved || review?.preview.alreadyApplied ? (
          <>
            <Button onClick={() => setShowEdits(true)}>
              View applied edits
            </Button>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button disabled={busy === "apply"} onClick={close}>
              Cancel
            </Button>
            {review ? (
              <>
                <Button disabled={!!busy} onClick={() => edit(input)}>
                  Edit response
                </Button>
                {review.preview.expected || canSelectEdits ? (
                  <Button
                    variant="primary"
                    disabled={!!busy || !canApply}
                    onClick={() => void apply()}
                  >
                    Apply to {source.key}
                  </Button>
                ) : (
                  onPrepare && (
                    <Button disabled={!!busy} onClick={onPrepare}>
                      Prepare fresh handoff
                    </Button>
                  )
                )}
              </>
            ) : (
              <Button
                variant="primary"
                disabled={!!busy || !input.trim()}
                onClick={() => void inspect()}
              >
                Preview edit
              </Button>
            )}
          </>
        )
      }
    >
      <div className="returned-proposal decision-handoff">
        {saved ? (
          <p role="status">
            {source.key} description updated
            {source.kind === "sample" ? " in the checkout example" : " in Jira"}
            .
          </p>
        ) : (
          <>
            {!review ? (
              <>
                <p>
                  Choose the returned JSON handoff or paste it below to preview
                  the proposed description changes.
                </p>
                <label>
                  Returned file
                  <input
                    type="file"
                    accept=".json,application/json"
                    disabled={!!busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void openFile(file);
                    }}
                  />
                </label>
                <label>
                  Handoff JSON
                  <textarea
                    rows={8}
                    value={input}
                    disabled={!!busy}
                    onChange={(e) => edit(e.target.value)}
                  />
                </label>
                {source.kind === "sample" && (
                  <Button
                    size="small"
                    disabled={!!busy}
                    onClick={() => edit(sampleResponse(source, entry))}
                  >
                    Load v{entry.version} sample response
                  </Button>
                )}
              </>
            ) : (
              <>
                <p>
                  <strong>Decision at v{entry.version}</strong>
                  <br />
                  {review.preview.context.evidence.review.reason ??
                    "No reason was recorded for this review."}
                </p>
                {review.preview.alreadyApplied && (
                  <p role="status">
                    The current ticket already contains the proposed result.
                  </p>
                )}
                {[...review.preview.notices, ...review.preview.problems].map(
                  (problem) => (
                    <p
                      key={problem}
                      className="handoff-plan-change"
                      role="status"
                    >
                      {problem}
                    </p>
                  ),
                )}
                {review.preview.plan && (
                  <details open>
                    <summary>Compare published plan wording</summary>
                    <div className="proposal-passages">
                      <section>
                        <h3>
                          At handoff · v{review.preview.plan.saved.version}
                        </h3>
                        <p>
                          {review.preview.plan.saved.text || "No plan text"}
                        </p>
                      </section>
                      <section>
                        <h3>
                          Current plan · v{review.preview.plan.current.version}
                        </h3>
                        <p>
                          {review.preview.plan.current.text || "No plan text"}
                        </p>
                      </section>
                    </div>
                  </details>
                )}
                {current && (
                  <div className="proposal-passages">
                    {review.preview.needsSelection && (
                      <section>
                        <h3>Ticket at handoff</h3>
                        <p>
                          {review.proposal.base.description || "No description"}
                        </p>
                      </section>
                    )}
                    <section>
                      <h3>Current ticket</h3>
                      <p>{current.description || "No description"}</p>
                    </section>
                  </div>
                )}
                {review.preview.needsSelection &&
                review.preview.choices.length ? (
                  <>
                    <fieldset className="returned-choices" disabled={!!busy}>
                      <legend>Choose which edits to apply</legend>
                      {review.preview.choices.map(
                        ({ change, problem }, index) => (
                          <div className="reviewed-passage" key={index}>
                            <label className="returned-choice">
                              <input
                                type="checkbox"
                                checked={kept.includes(index)}
                                disabled={!!problem}
                                onChange={(event) => {
                                  const checked = event.target.checked;
                                  setSelection((previous) => ({
                                    ...previous,
                                    kept: checked
                                      ? [...previous.kept, index]
                                      : previous.kept.filter(
                                          (i) => i !== index,
                                        ),
                                  }));
                                }}
                              />
                              Apply edit {index + 1}
                            </label>
                            <ProposedPassage change={change} />
                            {problem && (
                              <p className="handoff-plan-change">{problem}</p>
                            )}
                          </div>
                        ),
                      )}
                    </fieldset>
                    <label>
                      Why are you keeping these edits?
                      <textarea
                        value={selection.reason}
                        onChange={(event) => {
                          const reason = event.target.value;
                          setSelection((previous) => ({ ...previous, reason }));
                        }}
                        maxLength={maxReviewReason}
                        rows={2}
                        required
                        disabled={!!busy}
                      />
                    </label>
                    {selected.error && <p role="alert">{selected.error}</p>}
                  </>
                ) : (
                  review.proposal.changes.map((change, i) => (
                    <ProposedPassage change={change} key={i} />
                  ))
                )}
                {selected.doc && (
                  <details open>
                    <summary>Description after applying</summary>
                    <p>{plainText(selected.doc) || "No description"}</p>
                  </details>
                )}
              </>
            )}
            {busy && (
              <p role="status">
                {busy === "apply"
                  ? "Applying the reviewed edit…"
                  : "Reading the proposal…"}
              </p>
            )}
            {error && <p role="alert">{error}</p>}
          </>
        )}
      </div>
    </Dialog>
  );
}

function ProposedPassage({ change }: { change: PassageEdit }) {
  return (
    <>
      <div className="proposal-passages">
        <section>
          <h3>Original passage</h3>
          <p>{change.original || "Append at the end of the description."}</p>
        </section>
        <section>
          <h3>Proposed wording</h3>
          <p>{change.replacement || "Remove the original passage."}</p>
        </section>
      </div>
      {change.reason && <p>{change.reason}</p>}
    </>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Button } from "./ui";
import { compareWording, type WordingChange } from "../domain/plan-diff";
import {
  getSentenceEncoder,
  type SentenceEncoder,
} from "../domain/sentence-encoder";
import {
  editablePassages,
  newParagraph,
  matchPassage,
  suggestWording,
  type Passage,
} from "../domain/ticket-draft";
import type { AdfNode } from "../platform/atlassian-text";
import type { PlanPair } from "../platform/confluence-plan";

type Props = {
  versions: PlanPair;
  doc: AdfNode | null;
  issueKey: string;
  sample?: boolean;
  saving: boolean;
  onApply: (passage: Passage, wording: string) => Promise<void>;
  onCancel: () => void;
};

function short(text: string) {
  return text.length > 95 ? text.slice(0, 92) + "…" : text;
}

export function TicketDraft(props: Props) {
  const { versions, doc, saving, onCancel } = props;
  const diff = useMemo(
    () => compareWording(versions.saved.text, versions.current.text),
    [versions],
  );
  const passages = useMemo(() => editablePassages(doc), [doc]);
  const [encoder, setEncoder] = useState<SentenceEncoder | null>();
  const [index, setIndex] = useState(0);
  const [excerpt, setExcerpt] = useState("");
  const [selectedExcerpt, setSelectedExcerpt] = useState("");
  useEffect(() => {
    let active = true;
    getSentenceEncoder()
      .then((model) => {
        if (active) setEncoder(() => model);
      })
      .catch(() => {
        if (active) setEncoder(null);
      });
    return () => {
      active = false;
    };
  }, []);
  const change = useMemo(
    () =>
      diff.fullText
        ? selectedExcerpt
          ? { before: [], after: [selectedExcerpt] }
          : undefined
        : diff.groups[index],
    [diff, index, selectedExcerpt],
  );
  const nothingChanged = !diff.fullText && !diff.groups.length;
  return (
    <section className="ticket-draft" aria-label="Draft ticket update">
      <div className="live-heading">
        <h3>Draft ticket update</h3>
        <Button size="small" disabled={saving} onClick={onCancel}>
          Discard draft
        </Button>
      </div>
      {nothingChanged ? (
        <p>
          The plan wording matches the earlier version. There is no wording
          change to draft from.
        </p>
      ) : (
        <>
          {diff.groups.length > 1 && (
            <label>
              Plan change
              <select
                value={index}
                disabled={saving}
                onChange={(e) => setIndex(Number(e.target.value))}
              >
                {diff.groups.map((group, i) => (
                  <option key={i} value={i}>
                    {i + 1}.{" "}
                    {short(
                      (group.after.length ? group.after : group.before).join(
                        " ",
                      ),
                    )}
                  </option>
                ))}
              </select>
            </label>
          )}
          {diff.fullText && (
            <>
              <label>
                Excerpt from the current plan
                <textarea
                  rows={2}
                  value={excerpt}
                  disabled={saving}
                  onChange={(e) => setExcerpt(e.target.value)}
                />
              </label>
              <Button
                disabled={
                  saving ||
                  !excerpt.trim() ||
                  !versions.current.text.includes(excerpt.trim())
                }
                onClick={() => setSelectedExcerpt(excerpt.trim())}
              >
                Use this excerpt
              </Button>
            </>
          )}
          {change && (
            <>
              <p className="plan-meta">{versions.current.title} · Confluence</p>
              <div className="draft-evidence">
                {change.before.length > 0 && (
                  <div>
                    <strong>Earlier wording · v{versions.saved.version}</strong>
                    <p>{change.before.join(" ")}</p>
                  </div>
                )}
                {change.after.length > 0 && (
                  <div>
                    <strong>
                      Current wording · v{versions.current.version}
                    </strong>
                    <p>{change.after.join(" ")}</p>
                  </div>
                )}
              </div>
              {encoder === undefined ? (
                <p role="status">Finding the related ticket wording…</p>
              ) : (
                <>
                  {encoder === null && (
                    <p>
                      Passage matching is unavailable. Check the selected
                      passage before applying.
                    </p>
                  )}
                  <DraftChange
                    key={index + ":" + selectedExcerpt}
                    {...props}
                    passages={passages}
                    change={change}
                    encode={encoder ?? undefined}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function DraftChange({
  passages,
  change,
  encode,
  saving,
  onApply,
  issueKey,
  sample,
}: Props & {
  passages: Passage[];
  change: WordingChange;
  encode?: SentenceEncoder;
}) {
  const match = useMemo(
    () => matchPassage(passages, change, encode),
    [passages, change, encode],
  );
  const added = change.after.join(" ");
  const alreadyPresent =
    !!added && passages.some((p) => p.text.includes(added));
  const initial = alreadyPresent
    ? undefined
    : (match?.passage ?? (!change.before.length ? newParagraph : undefined));
  const [targetId, setTargetId] = useState(initial?.id ?? "");
  const [wording, setWording] = useState(() =>
    initial ? suggestWording(initial, change, match) : "",
  );
  const [error, setError] = useState("");
  const target =
    targetId === newParagraph.id
      ? newParagraph
      : passages.find((p) => p.id === targetId);
  function select(id: string) {
    const passage =
      id === newParagraph.id ? newParagraph : passages.find((p) => p.id === id);
    setTargetId(id);
    setError("");
    setWording(passage ? suggestWording(passage, change, match) : "");
  }
  const valid =
    !!target &&
    wording !== target.text &&
    (wording === "" ? target.id !== newParagraph.id : !!wording.trim());
  return (
    <>
      {alreadyPresent ? (
        <p>The published wording already appears in this ticket.</p>
      ) : (
        !initial && <p>Choose the ticket passage affected by this change.</p>
      )}
      <label>
        Ticket passage
        <select
          value={targetId}
          onChange={(e) => select(e.target.value)}
          disabled={saving}
        >
          <option value="">Choose a passage</option>
          {passages.map((p, i) => (
            <option key={p.id} value={p.id}>
              {i + 1}. {short(p.text)}
            </option>
          ))}
          {!!added && (
            <option value={newParagraph.id}>Add a paragraph at the end</option>
          )}
        </select>
      </label>
      {target && (
        <>
          {target.id !== newParagraph.id && (
            <div className="draft-original">
              <strong>Current wording</strong>
              <p>{target.text}</p>
            </div>
          )}
          <label>
            Proposed wording
            <textarea
              rows={4}
              disabled={saving}
              value={wording}
              onChange={(e) => {
                setWording(e.target.value);
                setError("");
              }}
            />
          </label>
          {target.id !== newParagraph.id &&
            match?.passage.id !== target.id &&
            change.before.length > 0 &&
            added &&
            wording !== added && (
              <Button
                size="small"
                disabled={saving}
                onClick={() => setWording(added)}
              >
                Replace passage with plan wording
              </Button>
            )}
          {wording === "" && target.text && (
            <p>Applying this draft removes the selected passage.</p>
          )}
          <p className="review-note">
            {sample
              ? "Applies to the sample ticket."
              : "The approved wording will be visible to people who can read this Jira ticket."}
          </p>
          <Button
            variant="primary"
            disabled={saving || !valid}
            onClick={async () => {
              if (!target || !valid) return;
              setError("");
              try {
                await onApply(target, wording);
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Couldn’t apply the ticket update.",
                );
              }
            }}
          >
            {saving ? "Applying…" : "Apply to " + issueKey}
          </Button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, PageTitle } from "../components/ui";
import type { SampleHandoffSource } from "../platform/decision-handoff";
import type { AppliedEdit } from "../platform/applied-edits";
import {
  ReturnedProposal,
  sampleResponse,
} from "../components/ReturnedProposal";
import { DecisionSearch } from "../components/DecisionSearch";
import { ReviewPanel } from "../components/NeedsReview";
import { DecisionForm, DecisionTimeline } from "../components/ReviewDecision";
import type {
  DecisionEntry,
  DecisionOutcome,
} from "../platform/review-decisions";
import { TicketDraft } from "../components/TicketDraft";
import { applyPassage, textDocument } from "../domain/ticket-draft";
import { plainText } from "../platform/atlassian-text";
import { PlanComparison } from "../components/PlanComparison";
import {
  CheckpointComparison,
  type CheckpointChoice,
} from "../components/CheckpointComparison";
import type { PlanReference } from "../platform/confluence-plan";
import { BranchInbox } from "../components/BranchInbox";
import {
  pendingDrafts,
  sortInboxDrafts,
  type InboxDraft,
} from "../platform/branch-inbox";
import { TicketBranches } from "../components/TicketBranches";
import { sampleBranchStore } from "../platform/ticket-branches";
import {
  checkoutExample as example,
  checkoutInboxDrafts,
} from "../data/checkout-example";

const secondChange =
  "Offer account creation on the receipt page after payment.";
const versions = [
  example.before + " " + example.payment,
  example.after + " " + example.payment,
  example.after + " " + secondChange + " " + example.payment,
].map((text, index) => ({
  id: "sample-checkout",
  version: index + 6,
  title: example.title,
  text,
}));

function sampleCheckpoint(
  number: number,
  version: number,
  summary: string,
  description: string,
): CheckpointChoice {
  return {
    id: String(number),
    label: "Save " + number + " · Plan v" + version,
    read: () => ({
      summary,
      description,
      plan: { cloudId: "sample", id: versions[0].id, version },
    }),
  };
}

async function readSamplePlan(ref: PlanReference) {
  const page = versions.find(
    (item) => item.version === ref.version && item.id === ref.id,
  );
  if (!page) throw new Error("This sample page version is unavailable.");
  return page;
}

const firstCheckpoint = sampleCheckpoint(
  1,
  versions[0].version,
  example.summary,
  example.ticketBefore,
);

export function CheckoutExample() {
  const [sampleReturn, setSampleReturn] = useState<DecisionEntry>();
  const [showInbox, setShowInbox] = useState(false);
  const [published, setPublished] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [inspecting, setInspecting] = useState(false);
  const [doc, setDoc] = useState(() => textDocument(example.ticketBefore));
  const [summary, setSummary] = useState(example.summary);
  const ticketText = plainText(doc);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const [outcome, setOutcome] = useState<DecisionOutcome | "">("");
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState<DecisionEntry[]>([]);
  const [appliedEdits, setAppliedEdits] = useState<AppliedEdit[]>([]);
  const [checkpoints, setCheckpoints] = useState([firstCheckpoint]);
  const latest = useRef({ checkpoints, doc, summary });
  useLayoutEffect(() => {
    latest.current = { checkpoints, doc, summary };
  }, [checkpoints, doc, summary]);
  function newBranchStore() {
    return sampleBranchStore({
      initialRevisions: checkoutInboxDrafts,
      checkpoint(id) {
        const choice = latest.current.checkpoints.find(
          (item) => item.id === id,
        );
        if (!choice) throw new Error("This sample checkpoint is unavailable.");
        return choice.read();
      },
      current() {
        const { doc, summary } = latest.current;
        return {
          id: example.key,
          key: example.key,
          summary,
          description: plainText(doc),
          descriptionDoc: doc,
        };
      },
      write(fields) {
        if (fields.summary !== undefined) {
          latest.current.summary = fields.summary;
          setSummary(fields.summary);
        }
        if (fields.description !== undefined) {
          latest.current.doc = fields.description ?? textDocument("");
          setDoc(latest.current.doc);
        }
      },
    });
  }
  const [branchStore, setBranchStore] = useState(newBranchStore);
  const loadInbox = useCallback(
    async (signal: AbortSignal) => {
      const { checkpoints, doc, summary } = latest.current;
      const live = { summary, description: plainText(doc) };
      const drafts: InboxDraft[] = [];
      for (const checkpoint of checkpoints) {
        if (signal.aborted) break;
        const history = await branchStore.list(checkpoint.id, signal);
        const base = await checkpoint.read();
        drafts.push(
          ...(await pendingDrafts(
            example.key,
            base,
            live,
            history.revisions,
            branchStore.inboxDecision,
            signal,
          )),
        );
      }
      return { drafts: sortInboxDrafts(drafts), unchecked: [] };
    },
    [branchStore],
  );
  const pending = published > reviewed;
  const current = versions[published];
  const baseline = versions[reviewed];
  const handoffSource: SampleHandoffSource = {
    kind: "sample",
    key: example.key,
    ticket: { summary, description: ticketText },
    descriptionDoc: doc,
    appliedEdits,
    applyReturnedEdit(nextDoc, edit) {
      setDoc(nextDoc);
      setAppliedEdits((previous) => [edit, ...previous]);
    },
    plan: current,
    readPlanVersion: (version) =>
      readSamplePlan({ cloudId: "sample", id: current.id, version }),
  };
  const item = {
    key: example.key,
    summary,
    ticketExcerpt: ticketText,
    planTitle: current.title,
    baseline: baseline.version,
    current: current.version,
    checkpointId: "sample-v6",
  };
  function openOutdatedDraft() {
    const earlier = history.find(
      (entry) => entry.version === versions[0].version,
    );
    const entry: DecisionEntry = earlier ?? {
      id: "sample-review-6",
      checkpointId: "sample-v6",
      pageId: current.id,
      version: versions[0].version,
      author: "Ricardo López (sample)",
      created: new Date().toISOString(),
      decision: {
        outcome: "kept",
        reason: "The published plan required sign-in before payment.",
        fromVersion: versions[0].version - 1,
        wording: {
          summary: example.summary,
          description: example.ticketBefore,
        },
      },
    };
    if (!earlier) setHistory((entries) => [...entries, entry]);
    if (published === 0) {
      setPublished(1);
      if (ticketText === example.ticketBefore)
        setDoc(textDocument(example.ticketAfter));
    }
    setSampleReturn(entry);
  }
  function restart() {
    setPublished(0);
    setReviewed(0);
    setDoc(textDocument(example.ticketBefore));
    setSummary(example.summary);
    setEditing(false);
    setInspecting(false);
    setNotice("");
    setOutcome("");
    setReason("");
    setHistory([]);
    setAppliedEdits([]);
    setCheckpoints([firstCheckpoint]);
    setBranchStore(newBranchStore());
  }
  function saveDecision() {
    if (!pending || !outcome || !reason.trim()) return;
    const entry: DecisionEntry = {
      id: "sample-review-" + current.version,
      checkpointId: item.checkpointId,
      pageId: current.id,
      version: current.version,
      author: "Ricardo López (sample)",
      created: new Date().toISOString(),
      decision: {
        outcome,
        reason: reason.trim(),
        fromVersion: baseline.version,
        wording: { summary, description: ticketText },
      },
    };
    setHistory((entries) => [
      entry,
      ...entries.filter((other) => other.id !== entry.id),
    ]);
    setReviewed(published);
    setInspecting(false);
    setNotice("");
    setOutcome("");
    setReason("");
  }
  if (showInbox)
    return (
      <>
        <PageTitle
          title="Branch inbox"
          description="Guest checkout · Sample scenario"
          actions={
            <Button size="small" onClick={() => setShowInbox(false)}>
              Back to checkout example
            </Button>
          }
        />
        <BranchInbox sample={{ load: loadInbox, store: branchStore }} />
      </>
    );
  return (
    <>
      <PageTitle
        title="Guest checkout"
        description="Nova Commerce · Sample scenario"
        actions={
          <Link to="/jira" className="text-link">
            Back to Jira checkpoints
          </Link>
        }
      />
      <section className="card padded-card">
        <p>
          {published === 0
            ? "Version 6 of the checkout plan requires sign-in before payment."
            : published === 1
              ? "Version 7 of the checkout plan allows guest purchases."
              : "Version 8 adds an offer to create an account after payment."}
        </p>
        <div className="live-heading-actions example-actions">
          {!pending && published < versions.length - 1 && (
            <Button
              variant="primary"
              onClick={() => {
                setPublished(published + 1);
                setNotice("");
                setInspecting(false);
              }}
            >
              {published === 0
                ? "Publish sample plan change"
                : "Publish next sample plan change"}
            </Button>
          )}
          <Button onClick={openOutdatedDraft}>Review an outdated draft</Button>
          <Button onClick={() => setShowInbox(true)}>Branch inbox</Button>
          <Button onClick={restart}>Restart example</Button>
        </div>
      </section>
      {inspecting && pending ? (
        <section className="card padded-card review-queue">
          <div className="live-heading">
            <h2>Review {example.key}</h2>
            <Button
              size="small"
              onClick={() => {
                setEditing(false);
                setInspecting(false);
              }}
            >
              Back to list
            </Button>
          </div>
          <PlanComparison
            versions={{ saved: baseline, current }}
            ticket={{ summary, description: ticketText }}
            issueKey={example.key}
            baselineIsReview={reviewed > 0}
          />
          {editing ? (
            <TicketDraft
              versions={{ saved: baseline, current }}
              doc={doc}
              issueKey={example.key}
              saving={false}
              sample
              onCancel={() => setEditing(false)}
              onApply={async (passage, wording) => {
                setDoc(applyPassage(doc, passage, wording));
                setNotice("Sample ticket updated.");
                setOutcome("updated");
                setEditing(false);
              }}
            />
          ) : (
            <>
              <div className="live-heading-actions">
                <Button
                  variant="primary"
                  onClick={() => {
                    setNotice("");
                    setEditing(true);
                  }}
                >
                  Draft ticket update
                </Button>
              </div>
              {notice && <p role="status">{notice}</p>}
              <DecisionForm
                version={current.version}
                outcome={outcome}
                reason={reason}
                setOutcome={setOutcome}
                setReason={setReason}
                sample
                onSave={saveDecision}
              />
            </>
          )}
        </section>
      ) : (
        <ReviewPanel
          items={pending ? [item] : []}
          onOpen={() => setInspecting(true)}
          empty="No linked plans need review."
        >
          {reviewed > 0 && !pending && (
            <p role="status">
              {example.key} · Decision saved for plan v{baseline.version}.
            </p>
          )}
        </ReviewPanel>
      )}
      {history.length > 0 && (
        <section className="card padded-card">
          <details className="sample-decision-search">
            <summary>Find a decision</summary>
            <DecisionSearch
              key={history.length}
              sample={{ ...handoffSource, entries: history }}
            />
          </details>
          <DecisionTimeline
            history={{ entries: history, unavailable: 0 }}
            handoffSource={handoffSource}
            pageLabel={example.title}
          />
        </section>
      )}
      <section className="card padded-card">
        <h2>Saved checkpoints</h2>
        <p role="status">Latest checkpoint · {checkpoints[0].label}</p>
        <div className="live-heading-actions">
          <Button
            size="small"
            onClick={() =>
              setCheckpoints((previous) => [
                sampleCheckpoint(
                  previous.length + 1,
                  current.version,
                  summary,
                  ticketText,
                ),
                ...previous,
              ])
            }
          >
            Save sample checkpoint
          </Button>
          <CheckpointComparison
            ticketKey={example.key}
            choices={checkpoints}
            readPlan={readSamplePlan}
            sample
          />
          <TicketBranches
            ticketKey={example.key}
            choices={checkpoints}
            store={branchStore}
            sampleDraft={{
              name: "Guest checkout pilot",
              summary: "Pilot guest checkout",
              description: example.ticketAfter,
            }}
          />
        </div>
        <details className="sample-current-ticket">
          <summary>Current sample ticket</summary>
          <strong>{summary}</strong>
          <p className="plan-wording">{ticketText || "No description"}</p>
        </details>
      </section>
      {sampleReturn && (
        <ReturnedProposal
          source={handoffSource}
          entry={sampleReturn}
          initialInput={sampleResponse(handoffSource, sampleReturn, true)}
          onClose={() => setSampleReturn(undefined)}
        />
      )}
    </>
  );
}

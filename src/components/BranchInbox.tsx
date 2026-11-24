import { InboxDecisionDialog } from "./InboxDecisionDialog";
import type { BranchReview } from "../platform/branch-publication";
import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import {
  loadProjectInbox,
  type BranchInboxResult,
  type InboxDraft,
} from "../platform/branch-inbox";
import { jiraBranchStore, type BranchStore } from "../platform/ticket-branches";
import { BranchPublication } from "./BranchPublication";
import { BranchPublicationHistory } from "./BranchPublicationHistory";
import { Button } from "./ui";

type OpenDraft = {
  draft: InboxDraft;
  store: BranchStore;
  history: boolean;
  decisionReview?: BranchReview;
};

export function BranchInbox({
  sample,
  initialRevision,
}: {
  initialRevision?: string;
  sample?: {
    load: (signal: AbortSignal) => Promise<BranchInboxResult>;
    store: BranchStore;
  };
}) {
  const [result, setResult] = useState<BranchInboxResult>();
  const [notice, setNotice] = useState("");
  const [scan, setScan] = useState(0);
  const [opened, setOpened] = useState<OpenDraft>();
  const initial = useRef(initialRevision);
  const recentlyUpdated = useRef<string | undefined>(undefined);
  const load = sample?.load ?? loadProjectInbox;
  useEffect(() => {
    const controller = new AbortController();
    setResult(undefined);
    load(controller.signal, recentlyUpdated.current).then(
      (next) => {
        if (!controller.signal.aborted) {
          setResult(next);
          const draft = next.drafts.find(
            ({ revision }) => revision.revisionId === initial.current,
          );
          initial.current = undefined;
          if (draft) open(draft);
        }
      },
      (error) => {
        if (!controller.signal.aborted)
          setResult({
            drafts: [],
            unchecked: [],
            error:
              error instanceof Error
                ? error.message
                : "Couldn’t load the branch inbox.",
          });
      },
    );
    return () => controller.abort();
  }, [load, scan]);

  function open(draft: InboxDraft) {
    const store =
      sample?.store ??
      jiraBranchStore(draft.ticketKey, (ticket) => {
        recentlyUpdated.current = ticket.id;
      });
    setNotice("");
    setOpened({ draft, store, history: false });
  }
  function close() {
    setOpened(undefined);
    setScan((n) => n + 1);
  }

  const active = result?.drafts.filter((draft) => !draft.setAside) ?? [];
  const aside = result?.drafts.filter((draft) => draft.setAside) ?? [];
  const partial = !!result?.error || !!result?.unchecked.length;
  return (
    <section
      className="card padded-card review-queue"
      aria-label="Drafts to review"
    >
      <div className="live-heading">
        <h2>
          Drafts to review
          {active.length > 0 ? " (" + active.length + ")" : ""}
        </h2>
        <Button
          size="small"
          disabled={!result}
          onClick={() => setScan((n) => n + 1)}
        >
          Refresh inbox
        </Button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {!result ? (
        <p role="status">Checking saved drafts against current tickets…</p>
      ) : (
        <>
          {result.error && (
            <p role="alert" className="live-error">
              {result.error}
            </p>
          )}
          {result.unchecked.length > 0 && (
            <p role="status">
              Some drafts couldn’t be checked on{" "}
              {result.unchecked.map((key, i) => (
                <span key={key}>
                  {i > 0 && ", "}
                  <Link
                    className="text-link"
                    to={"/jira?ticket=" + encodeURIComponent(key)}
                  >
                    {key}
                  </Link>
                </span>
              ))}
              .
            </p>
          )}
          {active.length ? (
            <DraftList drafts={active} onOpen={open} />
          ) : (
            <p>
              {partial
                ? "No pending edits found in the drafts checked so far."
                : aside.length
                  ? "All remaining drafts are set aside."
                  : "No pending draft edits. New wording saved in Ticket branches will appear here."}
            </p>
          )}
          {aside.length > 0 && (
            <details className="inbox-aside">
              <summary>Set aside ({aside.length})</summary>
              <DraftList drafts={aside} onOpen={open} />
            </details>
          )}
        </>
      )}
      {opened?.decisionReview ? (
        <InboxDecisionDialog
          draft={opened.draft}
          review={opened.decisionReview}
          store={opened.store}
          sample={!!sample}
          onClose={close}
          onSaved={(message) => {
            setNotice(message);
            close();
          }}
        />
      ) : (
        opened &&
        (opened.history ? (
          <BranchPublicationHistory
            store={opened.store}
            revision={opened.draft.revision}
            ticketKey={opened.draft.ticketKey}
            sample={!!sample}
            backLabel="Back to inbox"
            onClose={close}
            onReview={() => setOpened({ ...opened, history: false })}
          />
        ) : (
          <BranchPublication
            store={opened.store}
            revision={opened.draft.revision}
            ticketKey={opened.draft.ticketKey}
            sample={!!sample}
            backLabel="Back to inbox"
            onClose={close}
            inboxAction={
              opened.draft.decisionUnavailable
                ? undefined
                : {
                    label: opened.draft.setAside
                      ? "Return to inbox…"
                      : "Set aside…",
                    open: (review) =>
                      setOpened({ ...opened, decisionReview: review }),
                  }
            }
            onHistory={() => setOpened({ ...opened, history: true })}
          />
        ))
      )}
    </section>
  );
}

function DraftList({
  drafts,
  onOpen,
}: {
  drafts: InboxDraft[];
  onOpen: (draft: InboxDraft) => void;
}) {
  return (
    <ul>
      {drafts.map((draft) => (
        <li
          key={[
            draft.ticketKey,
            draft.revision.checkpointId,
            draft.revision.revisionId,
          ].join("/")}
        >
          <button onClick={() => onOpen(draft)}>
            <span>
              <strong>{draft.ticketKey}</strong> {draft.revision.name}
              {draft.conflicts.length > 0 && (
                <small>
                  Changed in both draft and ticket ·{" "}
                  {draft.conflicts.join(", ")}
                </small>
              )}
              {draft.changes.length > 0 && (
                <small>
                  Changed in draft only · {draft.changes.join(", ")}
                </small>
              )}
              {draft.decision?.state === "aside" && (
                <small>
                  {draft.setAside ? "Set aside" : "Previously set aside"} by{" "}
                  {draft.decision.author} ·{" "}
                  {new Date(draft.decision.created).toLocaleString()}
                  <span className="inbox-saved-reason">
                    {draft.decision.reason}
                  </span>
                </small>
              )}
              {draft.decisionUnavailable && (
                <small>
                  Couldn’t verify the inbox decision. Refresh to try again.
                </small>
              )}
              <small>
                {draft.revision.author} · Revision{" "}
                {draft.revision.revisionId.slice(0, 8)}
              </small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

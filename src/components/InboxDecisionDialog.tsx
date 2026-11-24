import { useRef, useState } from "react";
import type { InboxDraft } from "../platform/branch-inbox";
import type { BranchReview } from "../platform/branch-publication";
import {
  inboxReasonLimit,
  type InboxChange,
} from "../platform/inbox-decisions";
import type { BranchStore } from "../platform/ticket-branches";
import { Button, Dialog } from "./ui";

export function InboxDecisionDialog({
  draft,
  review,
  store,
  sample,
  onClose,
  onSaved,
}: {
  draft: InboxDraft;
  review: BranchReview;
  store: BranchStore;
  sample: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const request = useRef<InboxChange | undefined>(undefined);
  const restore = draft.setAside;
  const label = restore ? "Return to inbox" : "Set aside";

  async function save() {
    if (writing.current) return;
    const note = reason.trim();
    if (!restore && !note) return;
    if (!request.current || request.current.reason !== note)
      request.current = {
        id: crypto.randomUUID(),
        previousId: draft.decision?.id ?? null,
        state: restore ? "open" : "aside",
        reason: note,
      };
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      await store.saveInboxDecision(review, request.current);
      onSaved(
        restore
          ? draft.revision.name + " returned to the inbox."
          : draft.revision.name + " was set aside.",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn’t save the inbox decision. Try again.",
      );
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={
        restore ? "Return this draft to the inbox?" : "Set this draft aside?"
      }
      subtitle={
        draft.ticketKey +
        " · " +
        draft.revision.name +
        " · Revision " +
        draft.revision.revisionId.slice(0, 8) +
        (sample ? " · Sample ticket" : "")
      }
      onClose={() => {
        if (!writing.current) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Back to inbox
          </Button>
          <Button
            variant="primary"
            disabled={busy || (!restore && !reason.trim())}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : label}
          </Button>
        </>
      }
    >
      {restore ? (
        <>
          <p>This revision will appear in Drafts to review again.</p>
          <p>Reason it was set aside · {draft.decision?.reason}</p>
        </>
      ) : (
        <>
          <p>
            {sample ? "The sample inbox" : "Your team’s inbox"} will show this
            revision under Set aside. A new revision or different ticket wording
            in a field this draft edits brings it back for review.
          </p>
          <label className="inbox-reason">
            Reason for setting this aside
            <textarea
              value={reason}
              maxLength={inboxReasonLimit}
              rows={3}
              disabled={busy}
              required
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </>
      )}
      {error && (
        <p className="live-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

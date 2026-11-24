import {
  attachInboxDecision,
  prepareInboxChange,
  readInboxDecision,
  type InboxChange,
  type InboxDecision,
} from "./inbox-decisions";
import {
  attachJson,
  commitBranchFields,
  issueChanges,
  pendingBranchFields,
  maxAttachmentBytes,
  readAttachmentJson,
  readCheckpoint,
  readTicket,
  sameText,
  type CheckpointFile,
  type Ticket,
  type TicketText,
  type TicketFieldUpdate,
} from "./jira-checkpoints";
import {
  branchPublication,
  type BranchPublication,
  type BranchReview,
  type BranchBase,
  type PublicationTicket,
  type TicketField,
} from "./branch-publication";
import { runtime } from "./runtime";
import {
  branchPublicationType,
  collectBranchReceipts,
  type PublicationHistory,
  type PublicationReceipt,
} from "./branch-receipts";

export type BranchDraft = TicketText & {
  checkpointId: string;
  branchId: string;
  revisionId: string;
  parentId: string | null;
  name: string;
};
export type BranchRevision = BranchDraft & { author: string; created: string };
export type BranchHistory = {
  revisions: BranchRevision[];
  unavailable: number;
};
export type BranchStore = BranchPublication & {
  saveInboxDecision: (
    review: BranchReview,
    change: InboxChange,
  ) => Promise<void>;
  list: (checkpointId: string, signal: AbortSignal) => Promise<BranchHistory>;
  save: (draft: BranchDraft) => Promise<BranchRevision>;
  publicationHistory: (
    revision: BranchRevision,
    signal: AbortSignal,
  ) => Promise<PublicationHistory>;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validId = (value: unknown): value is string =>
  typeof value === "string" && uuid.test(value);
const format = "kinlet.ticket-branch.v1";
const prefix = (checkpointId: string) => "kinlet-branch-" + checkpointId + "_";
const filename = (d: BranchDraft) =>
  prefix(d.checkpointId) +
  [d.branchId, d.parentId ?? "root", d.revisionId].join("_") +
  ".json";

function validDraft(d: BranchDraft) {
  return (
    typeof d.name === "string" &&
    d.name === d.name.trim() &&
    d.name.length > 0 &&
    d.name.length <= 80 &&
    typeof d.summary === "string" &&
    !!d.summary.trim() &&
    typeof d.description === "string" &&
    validId(d.revisionId) &&
    validId(d.branchId) &&
    (d.parentId === null
      ? d.branchId === d.revisionId
      : validId(d.parentId) && d.parentId !== d.revisionId)
  );
}

export function orderedRevisions(revisions: BranchRevision[]) {
  return [...revisions].sort(
    (a, b) =>
      Date.parse(b.created) - Date.parse(a.created) ||
      b.revisionId.localeCompare(a.revisionId),
  );
}

function verifyRetry(saved: BranchRevision, draft: BranchDraft) {
  if (
    filename(saved) !== filename(draft) ||
    saved.name !== draft.name ||
    !sameText(saved, draft)
  )
    throw new Error(
      "This save reference already belongs to a different draft. Reopen the branch before saving.",
    );
  return saved;
}

function checkParent(
  draft: BranchDraft,
  parent: BranchRevision | undefined,
  hasNewer: boolean,
) {
  if (!validDraft(draft))
    throw new Error("Enter a branch name and ticket summary before saving.");
  if (draft.parentId && (!parent || parent.checkpointId !== draft.checkpointId))
    throw new Error(
      "The source revision is no longer available. You can copy your wording before closing.",
    );
  if (draft.branchId !== draft.revisionId) {
    if (parent?.branchId !== draft.branchId || parent.name !== draft.name)
      throw new Error("This branch no longer matches the selected revision.");
    if (hasNewer)
      throw new Error(
        "Someone already saved a later revision. Save your wording as a new branch or return to the revision list.",
      );
  }
}

async function readRevision(
  ticket: Ticket,
  checkpointId: string,
  file: CheckpointFile,
): Promise<BranchRevision> {
  if (file.size > maxAttachmentBytes)
    throw new Error("This draft exceeds the attachment size limit.");
  const data = await readAttachmentJson(file);
  if (
    data?.format !== format ||
    data.issueId !== ticket.id ||
    data.cloudId !== runtime.cloudId ||
    data.checkpointId !== checkpointId ||
    !validDraft(data) ||
    filename(data) !== file.filename
  )
    throw new Error(
      "This attachment does not contain a valid revision for the selected checkpoint.",
    );
  return {
    checkpointId,
    branchId: data.branchId,
    revisionId: data.revisionId,
    parentId: data.parentId,
    name: data.name,
    summary: data.summary,
    description: data.description,
    author: file.author?.displayName || "Jira user",
    created: file.created,
  };
}

export function branchHeads(revisions: BranchRevision[]) {
  // A fork starts a new branch, so its parent is still current on the source branch.
  const superseded = new Set(
    revisions.filter((r) => r.branchId !== r.revisionId).map((r) => r.parentId),
  );
  return revisions.filter((r) => !superseded.has(r.revisionId));
}

export function branchCheckpointId(file: CheckpointFile) {
  return /^kinlet-branch-(\d+)_/.exec(file.filename)?.[1];
}

export async function readBranchHistory(
  ticket: Ticket,
  checkpointId: string,
  signal: AbortSignal,
  files = ticket.branchFiles.filter((f) =>
    f.filename.startsWith(prefix(checkpointId)),
  ),
): Promise<BranchHistory> {
  const entries = new Map<string, BranchRevision>();
  let unavailable = 0;
  for (let i = 0; i < files.length && !signal.aborted; i += 4) {
    const batch = await Promise.allSettled(
      files
        .slice(i, i + 4)
        .map((file) => readRevision(ticket, checkpointId, file)),
    );
    for (const result of batch) {
      if (result.status === "fulfilled")
        entries.set(result.value.revisionId, result.value);
      else unavailable++;
    }
  }
  return {
    revisions: orderedRevisions([...entries.values()]),
    unavailable,
  };
}

export function jiraBranchStore(
  key: string,
  onUpdated: (ticket: Ticket) => void,
): BranchStore {
  async function reviewRevision(selected: BranchRevision) {
    const live = await readTicket(key);
    const baseFile = live.files.find((f) => f.id === selected.checkpointId);
    const draftFile = live.branchFiles.find(
      (f) => f.filename === filename(selected),
    );
    if (!baseFile || !draftFile)
      throw new Error(
        "This checkpoint or draft revision is no longer available on the ticket.",
      );
    const [base, saved] = await Promise.all([
      readCheckpoint(live, baseFile),
      readRevision(live, selected.checkpointId, draftFile),
    ]);
    return { base, revision: verifyRetry(saved, selected), live };
  }
  const publication = branchPublication(
    reviewRevision,
    async ({ live, revision }, fields) => {
      const result = await commitBranchFields(live, fields, {
        type: branchPublicationType,
        activityDescription: "Applied a ticket branch in Kinlet",
        extraData: {
          checkpointId: revision.checkpointId,
          branchId: revision.branchId,
          revisionId: revision.revisionId,
          branchName: revision.name,
        },
      });
      onUpdated(result.ticket);
      return result.changed;
    },
  );
  return {
    ...publication,
    async saveInboxDecision(review, change) {
      const fresh = await reviewRevision(review.revision);
      const { live, revision } = fresh;
      const childPrefix =
        prefix(revision.checkpointId) +
        revision.branchId +
        "_" +
        revision.revisionId +
        "_";
      if (live.branchFiles.some((f) => f.filename.startsWith(childPrefix)))
        throw new Error(
          "A newer draft revision is available. Return to the inbox to review it.",
        );
      const current = await readInboxDecision(live, revision);
      const evidence = await prepareInboxChange(review, fresh, current, change);
      if (evidence) {
        await attachInboxDecision(live, revision, change, evidence);
        const confirmed = await readTicket(key);
        if ((await readInboxDecision(confirmed, revision))?.id !== change.id)
          throw new Error(
            "Couldn’t confirm this decision. Return to the inbox to see the current choice.",
          );
        onUpdated(confirmed);
      } else onUpdated(live);
    },
    async publicationHistory(revision, signal) {
      const review = await publication.review(revision);
      const records = await collectBranchReceipts(
        review.revision,
        issueChanges(review.live.id, signal),
      );
      return { review, ...records };
    },
    async list(checkpointId, signal) {
      const ticket = await readTicket(key);
      return readBranchHistory(ticket, checkpointId, signal);
    },
    async save(draft) {
      const ticket = await readTicket(key);
      const files = ticket.branchFiles.filter((f) =>
        f.filename.startsWith(prefix(draft.checkpointId)),
      );
      const existing = files.find((f) => f.filename === filename(draft));
      if (existing)
        return verifyRetry(
          await readRevision(ticket, draft.checkpointId, existing),
          draft,
        );
      const base = ticket.files.find((f) => f.id === draft.checkpointId);
      if (!base)
        throw new Error("The source checkpoint is no longer available.");
      await readCheckpoint(ticket, base);
      const parentFile =
        draft.parentId &&
        files.find((f) => f.filename.endsWith("_" + draft.parentId + ".json"));
      const parent = parentFile
        ? await readRevision(ticket, draft.checkpointId, parentFile)
        : undefined;
      const childPrefix =
        prefix(draft.checkpointId) +
        draft.branchId +
        "_" +
        draft.parentId +
        "_";
      checkParent(
        draft,
        parent,
        files.some((f) => f.filename.startsWith(childPrefix)),
      );
      const file = await attachJson(ticket.id, filename(draft), {
        format,
        issueId: ticket.id,
        cloudId: runtime.cloudId,
        ...draft,
      });
      return {
        ...draft,
        author: file.author?.displayName || "Jira user",
        created: file.created,
      };
    },
  };
}

export function sampleBranchStore(source: {
  initialRevisions?: BranchRevision[];
  checkpoint: (id: string) => BranchBase | Promise<BranchBase>;
  current: () => PublicationTicket;
  write: (fields: TicketFieldUpdate) => void;
}): BranchStore & {
  inboxDecision: (
    revision: BranchRevision,
  ) => Promise<InboxDecision | undefined>;
} {
  const decisions = new Map<string, InboxDecision>();
  const revisions = new Map(
    (source.initialRevisions ?? []).map((draft) => [draft.revisionId, draft]),
  );
  const receipts = new Map<string, PublicationReceipt[]>();
  const publication = branchPublication(
    async (selected) => {
      const saved = revisions.get(selected.revisionId);
      if (!saved) throw new Error("This sample revision is unavailable.");
      const base = await source.checkpoint(selected.checkpointId);
      return {
        base,
        revision: verifyRetry(saved, selected),
        live: source.current(),
      };
    },
    async ({ live, revision }, fields) => {
      const current = source.current();
      const update = pendingBranchFields(live, current, fields);
      const changed = Object.keys(update) as TicketField[];
      if (changed.length) {
        source.write(update);
        const receipt: PublicationReceipt = {
          id: crypto.randomUUID(),
          author: "Ricardo López (sample)",
          created: new Date().toISOString(),
          changes: changed.map((field) => ({
            field,
            before: current[field],
            after: revision[field],
          })),
        };
        receipts.set(revision.revisionId, [
          receipt,
          ...(receipts.get(revision.revisionId) ?? []),
        ]);
      }
      return changed;
    },
  );
  return {
    ...publication,
    async inboxDecision(revision) {
      return decisions.get(revision.revisionId);
    },
    async saveInboxDecision(review, change) {
      const fresh = await publication.review(review.revision);
      const id = fresh.revision.revisionId;
      const current = decisions.get(id);
      const evidence = await prepareInboxChange(review, fresh, current, change);
      if (!evidence) return;
      if (
        current !== decisions.get(id) ||
        !branchHeads([...revisions.values()]).some((r) => r.revisionId === id)
      )
        throw new Error(
          "The draft or its inbox decision changed. Return to the inbox and review it again.",
        );
      decisions.set(id, {
        ...change,
        evidence,
        author: "Ricardo López (sample)",
        created: new Date().toISOString(),
      });
    },
    async publicationHistory(revision) {
      const review = await publication.review(revision);
      return {
        review,
        receipts: receipts.get(review.revision.revisionId) ?? [],
        incomplete: 0,
      };
    },
    async list(checkpointId) {
      return {
        revisions: orderedRevisions(
          [...revisions.values()].filter(
            (r) => r.checkpointId === checkpointId,
          ),
        ),
        unavailable: 0,
      };
    },
    async save(draft) {
      const existing = revisions.get(draft.revisionId);
      if (existing) return verifyRetry(existing, draft);
      const parent = draft.parentId ? revisions.get(draft.parentId) : undefined;
      checkParent(
        draft,
        parent,
        [...revisions.values()].some(
          (r) => r.branchId === draft.branchId && r.parentId === draft.parentId,
        ),
      );
      const revision = {
        ...draft,
        author: "Ricardo López (sample)",
        created: new Date().toISOString(),
      };
      revisions.set(revision.revisionId, revision);
      return revision;
    },
  };
}

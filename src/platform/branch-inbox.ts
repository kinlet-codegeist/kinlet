import {
  inboxEvidence,
  readInboxDecision,
  type InboxDecision,
} from "./inbox-decisions";
import {
  ticketFields,
  wordingStatus,
  type TicketField,
} from "./branch-publication";
import {
  projectAttachmentTickets,
  readCheckpoint,
  readTicket,
  type CheckpointFile,
  type IndexedTicket,
  type TicketText,
} from "./jira-checkpoints";
import {
  branchCheckpointId,
  branchHeads,
  readBranchHistory,
  type BranchRevision,
} from "./ticket-branches";

export type InboxDraft = {
  ticketKey: string;
  revision: BranchRevision;
  conflicts: TicketField[];
  changes: TicketField[];
  decision?: InboxDecision;
  setAside: boolean;
  decisionUnavailable?: boolean;
};

export type BranchInboxResult = {
  drafts: InboxDraft[];
  unchecked: string[];
  error?: string;
};

export async function pendingDrafts(
  ticketKey: string,
  base: TicketText,
  live: TicketText,
  revisions: BranchRevision[],
  readDecision: (
    revision: BranchRevision,
  ) => Promise<InboxDecision | undefined>,
  signal: AbortSignal,
) {
  const drafts: InboxDraft[] = [];
  for (const revision of branchHeads(revisions)) {
    if (signal.aborted) break;
    const conflicts: TicketField[] = [];
    const changes: TicketField[] = [];
    for (const field of ticketFields) {
      const status = wordingStatus(base[field], revision[field], live[field]);
      if (status === "conflict") conflicts.push(field);
      if (status === "ready") changes.push(field);
    }
    if (!changes.length && !conflicts.length) continue;
    const draft: InboxDraft = {
      ticketKey,
      revision,
      conflicts,
      changes,
      setAside: false,
    };
    try {
      draft.decision = await readDecision(revision);
      draft.setAside =
        draft.decision?.state === "aside" &&
        draft.decision.evidence === (await inboxEvidence(base, revision, live));
    } catch {
      // Keep the draft visible when its inbox decision cannot be verified.
      draft.decisionUnavailable = true;
    }
    drafts.push(draft);
  }
  return drafts;
}

export function sortInboxDrafts(drafts: InboxDraft[]) {
  return drafts.sort(
    (a, b) =>
      b.conflicts.length - a.conflicts.length ||
      a.ticketKey.localeCompare(b.ticketKey, undefined, { numeric: true }) ||
      a.revision.name.localeCompare(b.revision.name) ||
      Date.parse(b.revision.created) - Date.parse(a.revision.created) ||
      a.revision.revisionId.localeCompare(b.revision.revisionId),
  );
}

async function checkTicketDrafts(indexed: IndexedTicket, signal: AbortSignal) {
  const ticket = await readTicket(indexed.key);
  const drafts: InboxDraft[] = [];
  if (ticket.id !== indexed.id) return { drafts, incomplete: true };

  const checkpoints = new Map(ticket.files.map((file) => [file.id, file]));
  const groups = new Map<CheckpointFile, CheckpointFile[]>();
  let incomplete = false;
  for (const file of ticket.branchFiles) {
    const baseFile = checkpoints.get(branchCheckpointId(file) ?? "");
    if (!baseFile) {
      incomplete = true;
      continue;
    }
    const group = groups.get(baseFile);
    if (group) group.push(file);
    else groups.set(baseFile, [file]);
  }
  for (const [checkpoint, files] of groups) {
    if (signal.aborted) break;
    const [base, history] = await Promise.allSettled([
      readCheckpoint(ticket, checkpoint),
      readBranchHistory(ticket, checkpoint.id, signal, files),
    ]);
    // An unreadable revision could supersede a readable draft.
    if (
      base.status === "rejected" ||
      history.status === "rejected" ||
      history.value.unavailable
    ) {
      incomplete = true;
      continue;
    }
    drafts.push(
      ...(await pendingDrafts(
        ticket.key,
        base.value,
        ticket,
        history.value.revisions,
        (r) => readInboxDecision(ticket, r),
        signal,
      )),
    );
  }
  return { drafts, incomplete };
}

export async function loadProjectInbox(
  signal: AbortSignal,
  recentlyUpdated?: string,
): Promise<BranchInboxResult> {
  const result: BranchInboxResult = { drafts: [], unchecked: [] };
  const seen = new Set<string>();
  try {
    for await (const page of projectAttachmentTickets(
      signal,
      recentlyUpdated,
    )) {
      const candidates = page.filter((ticket) => {
        if (!ticket.branchFiles.length || seen.has(ticket.id)) return false;
        seen.add(ticket.id);
        return true;
      });
      for (let i = 0; i < candidates.length; i += 2) {
        if (signal.aborted) return result;
        const batch = candidates.slice(i, i + 2);
        const checked = await Promise.allSettled(
          batch.map((ticket) => checkTicketDrafts(ticket, signal)),
        );
        checked.forEach((entry, index) => {
          if (entry.status === "fulfilled")
            result.drafts.push(...entry.value.drafts);
          if (entry.status === "rejected" || entry.value.incomplete)
            result.unchecked.push(batch[index].key);
        });
      }
    }
  } catch (error) {
    result.error =
      error instanceof Error
        ? error.message
        : "Couldn’t finish checking project tickets.";
  }
  sortInboxDrafts(result.drafts);
  return result;
}

import { ticketFields, type BranchReview } from "./branch-publication";
import {
  attachJson,
  readAttachmentJson,
  type CheckpointFile,
  type Ticket,
  type TicketText,
} from "./jira-checkpoints";
import { runtime } from "./runtime";
import type { BranchRevision } from "./ticket-branches";

export const inboxReasonLimit = 500;
export type InboxChange = {
  id: string;
  previousId: string | null;
  state: "aside" | "open";
  reason: string;
};
export type InboxDecision = InboxChange & {
  evidence: string;
  author: string;
  created: string;
};

const format = "kinlet.inbox-decision.v1";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const prefix = (r: BranchRevision) =>
  "kinlet-inbox-" + r.checkpointId + "_" + r.revisionId + "_";
const suffix = (change: InboxChange) =>
  (change.previousId ?? "root") + "_" + change.id + ".json";
const stale = () =>
  new Error(
    "This draft or its inbox decision changed. Return to the inbox and review it again.",
  );

export async function inboxEvidence(
  base: TicketText,
  revision: TicketText,
  live: TicketText,
) {
  const wording = ticketFields
    .filter((f) => revision[f] !== base[f])
    .map((f) => [f, base[f], revision[f], live[f]]);
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(wording)),
  );
  return Array.from(new Uint8Array(bytes), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}

function validChange(change: InboxChange) {
  return (
    uuid.test(change.id) &&
    (change.previousId === null || uuid.test(change.previousId)) &&
    (change.state === "open"
      ? change.reason === ""
      : change.state === "aside" &&
        typeof change.reason === "string" &&
        !!change.reason.trim() &&
        change.reason.length <= inboxReasonLimit)
  );
}

// Each decision names the one it replaces. Parallel saves from the same parent
// resolve to the first Jira attachment. A later retry cannot undo a newer choice.
export function latestInboxFile(
  files: CheckpointFile[],
  revision: BranchRevision,
) {
  const start = prefix(revision);
  const ordered = files
    .filter((f) => f.filename.startsWith(start))
    .sort(
      (a, b) =>
        Date.parse(a.created) - Date.parse(b.created) ||
        a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
  let parent = "root";
  let latest: CheckpointFile | undefined;
  for (const file of ordered) {
    const [previous, id] = file.filename.slice(start.length).split("_");
    if (previous !== parent || !id?.endsWith(".json")) continue;
    const next = id.slice(0, -5);
    if (
      !uuid.test(next) ||
      file.filename !== start + parent + "_" + next + ".json"
    )
      continue;
    parent = next;
    latest = file;
  }
  return latest;
}

export async function readInboxDecision(
  ticket: Ticket,
  revision: BranchRevision,
): Promise<InboxDecision | undefined> {
  const file = latestInboxFile(ticket.inboxFiles, revision);
  if (!file) return;
  const data = file.size <= 8192 && (await readAttachmentJson(file));
  if (
    !data ||
    data.format !== format ||
    !validChange(data) ||
    !/^[0-9a-f]{64}$/.test(data.evidence) ||
    data.issueId !== ticket.id ||
    data.cloudId !== runtime.cloudId ||
    data.checkpointId !== revision.checkpointId ||
    data.branchId !== revision.branchId ||
    data.revisionId !== revision.revisionId ||
    file.filename !== prefix(revision) + suffix(data)
  )
    throw new Error("Couldn’t read the latest inbox decision on this ticket.");
  return {
    id: data.id,
    previousId: data.previousId,
    state: data.state,
    reason: data.reason,
    evidence: data.evidence,
    author: file.author?.displayName ?? "Jira user",
    created: file.created,
  };
}

export async function prepareInboxChange(
  review: BranchReview,
  fresh: BranchReview,
  current: InboxDecision | undefined,
  change: InboxChange,
) {
  if (!validChange(change))
    throw new Error(
      "Enter a reason of up to " + inboxReasonLimit + " characters.",
    );
  if (
    review.live.id !== fresh.live.id ||
    review.revision.revisionId !== fresh.revision.revisionId
  )
    throw stale();
  const [evidence, now] = await Promise.all(
    [review, fresh].map((r) => inboxEvidence(r.base, r.revision, r.live)),
  );
  if (
    evidence !== now ||
    !ticketFields.some(
      (f) =>
        fresh.base[f] !== fresh.revision[f] &&
        fresh.live[f] !== fresh.revision[f],
    )
  )
    throw stale();
  if (
    current?.id === change.id &&
    current.previousId === change.previousId &&
    current.state === change.state &&
    current.reason === change.reason &&
    current.evidence === evidence
  )
    return;
  const alreadyAside =
    current?.state === "aside" && current.evidence === evidence;
  if (
    (current?.id ?? null) !== change.previousId ||
    alreadyAside === (change.state === "aside")
  )
    throw stale();
  return evidence;
}

export async function attachInboxDecision(
  ticket: Ticket,
  revision: BranchRevision,
  change: InboxChange,
  evidence: string,
) {
  return attachJson(ticket.id, prefix(revision) + suffix(change), {
    format,
    cloudId: runtime.cloudId,
    issueId: ticket.id,
    checkpointId: revision.checkpointId,
    branchId: revision.branchId,
    revisionId: revision.revisionId,
    ...change,
    evidence,
  });
}

import {
  reviewFiles,
  readDecisionEntry,
  validDecision,
  type DecisionInput,
} from "./review-decisions";
import { applyPassage, type Passage } from "../domain/ticket-draft";
import {
  readPlanHead,
  readPlanPair,
  type PlanReference,
} from "./confluence-plan";
import {
  attachJson,
  projectAttachmentTickets,
  sameText,
  readCheckpoint,
  readTicket,
  commitReviewedDescription,
  type IndexedTicket,
} from "./jira-checkpoints";

export type ReviewItem = {
  key: string;
  summary: string;
  ticketExcerpt: string;
  planTitle: string;
  baseline: number;
  current: number;
  checkpointId: string;
};

type TrackedPlan = { checkpointId: string; plan: PlanReference };
type PlanHead = Awaited<ReturnType<typeof readPlanHead>>;

export async function latestLinkedCheckpoint(
  ticket: IndexedTicket,
): Promise<TrackedPlan | undefined> {
  // A ticket-only snapshot does not change which plan is being tracked.
  for (const file of ticket.files) {
    const snapshot = await readCheckpoint(ticket, file);
    if (snapshot.plan) return { checkpointId: file.id, plan: snapshot.plan };
  }
}

async function reviewedThrough(
  ticket: IndexedTicket,
  link: TrackedPlan,
  currentVersion: number,
) {
  const candidates = reviewFiles(ticket)
    .filter(
      (ref) =>
        ref.checkpointId === link.checkpointId &&
        ref.version > link.plan.version &&
        ref.version <= currentVersion,
    )
    .sort((a, b) => b.version - a.version);
  for (const ref of candidates) {
    const entry = await readDecisionEntry(ticket, ref);
    if (entry && entry.pageId === link.plan.id) return entry.version;
  }
  return link.plan.version;
}

export type ReviewList = {
  items: ReviewItem[];
  unchecked: string[];
  tracked: number;
  error?: string;
};

export async function listPlanReviews(
  signal: AbortSignal,
  reconcileIssue?: string,
): Promise<ReviewList> {
  const result: ReviewList = { items: [], unchecked: [], tracked: 0 };
  const heads = new Map<string, Promise<PlanHead>>();
  const seen = new Set<string>();
  async function inspect(candidate: IndexedTicket) {
    // The search index can lag behind newly added reviews. Read current issue attachments before deciding.
    const ticket = await readTicket(candidate.key);
    const link = await latestLinkedCheckpoint(ticket);
    if (!link || signal.aborted) return;
    result.tracked++;
    const cacheKey = link.plan.cloudId + "/" + link.plan.id;
    let request = heads.get(cacheKey);
    if (!request) {
      request = readPlanHead(link.plan);
      heads.set(cacheKey, request);
    }
    const head = await request;
    if (head.version < link.plan.version)
      throw new Error("Current version unavailable.");
    const baseline = await reviewedThrough(ticket, link, head.version);
    if (head.version > baseline)
      result.items.push({
        key: ticket.key,
        summary: ticket.summary,
        ticketExcerpt: ticket.description,
        planTitle: head.title,
        baseline,
        current: head.version,
        checkpointId: link.checkpointId,
      });
  }
  try {
    for await (const tickets of projectAttachmentTickets(
      signal,
      reconcileIssue,
    )) {
      for (
        let offset = 0;
        offset < tickets.length && !signal.aborted;
        offset += 4
      ) {
        await Promise.all(
          tickets.slice(offset, offset + 4).map(async (ticket) => {
            if (!ticket.files.length || seen.has(ticket.id)) return;
            seen.add(ticket.id);
            try {
              await inspect(ticket);
            } catch {
              result.unchecked.push(ticket.key);
            }
          }),
        );
      }
    }
  } catch (err) {
    result.error =
      err instanceof Error
        ? err.message
        : "Couldn’t finish checking this project.";
  }
  result.items.sort((a, b) =>
    a.key.localeCompare(b.key, undefined, { numeric: true }),
  );
  return result;
}

async function currentReview(item: ReviewItem) {
  const ticket = await readTicket(item.key);
  const link = await latestLinkedCheckpoint(ticket);
  if (!link || link.checkpointId !== item.checkpointId)
    throw new Error("The tracked checkpoint changed. Refresh Needs review.");
  const head = await readPlanHead(link.plan);
  const baseline = await reviewedThrough(ticket, link, head.version);
  return { ticket, link, baseline, current: head.version };
}

export async function openPlanReview(item: ReviewItem) {
  const { ticket, link, baseline, current } = await currentReview(item);
  if (current < baseline)
    throw new Error("The current page version is unavailable.");
  if (current === baseline) return null;
  const versions = await readPlanPair({ ...link.plan, version: baseline });
  return { ticket, versions, baselineIsReview: baseline > link.plan.version };
}

export async function recordPlanReview(
  item: ReviewItem,
  review: OpenReview,
  input: DecisionInput,
  requestId: string,
) {
  if (!validDecision(input))
    throw new Error("Choose a decision and enter a reason before saving.");
  const { saved, current } = review.versions;
  const filename =
    "kinlet-review-" +
    item.checkpointId +
    "-v" +
    current.version +
    "-" +
    requestId +
    ".json";
  const ticket = await readTicket(item.key);
  if (ticket.id !== review.ticket.id)
    throw new Error("This ticket has changed. Reopen the review.");
  const existing = reviewFiles(ticket).find(
    (ref) => ref.file.filename === filename,
  );
  if (existing) {
    const entry = await readDecisionEntry(ticket, existing);
    if (
      entry?.pageId === current.id &&
      entry.decision?.outcome === input.outcome &&
      entry.decision.reason === input.reason.trim() &&
      sameText(entry.decision.wording, review.ticket) &&
      entry.decision.fromVersion === saved.version
    )
      return ticket.id;
    throw new Error(
      "This save could not be confirmed. Open the ticket’s decision history.",
    );
  }
  const link = await latestLinkedCheckpoint(ticket);
  if (
    !link ||
    link.checkpointId !== item.checkpointId ||
    link.plan.id !== current.id
  )
    throw new Error("The linked checkpoint changed. Reopen Needs review.");
  const head = await readPlanHead(link.plan);
  if (
    saved.version < link.plan.version ||
    saved.version >= current.version ||
    current.version > head.version
  )
    throw new Error("Reopen the review to see the available plan versions.");
  if (!sameText(ticket, review.ticket))
    throw new Error(
      "The ticket wording changed. Refresh the ticket wording and check your decision before saving.",
    );
  await attachJson(ticket.id, filename, {
    format: "kinlet.review.v2",
    requestId,
    issueId: ticket.id,
    checkpointId: link.checkpointId,
    cloudId: link.plan.cloudId,
    pageId: link.plan.id,
    fromVersion: saved.version,
    version: current.version,
    decision: { outcome: input.outcome, reason: input.reason.trim() },
    wording: { summary: ticket.summary, description: ticket.description },
  });
  return ticket.id;
}

export type OpenReview = NonNullable<
  Awaited<ReturnType<typeof openPlanReview>>
>;

export async function applyTicketDraft(
  item: ReviewItem,
  review: OpenReview,
  passage: Passage,
  wording: string,
) {
  const expected = applyPassage(review.ticket.descriptionDoc, passage, wording);
  const { link, baseline, current } = await currentReview(item);
  if (
    link.plan.id !== review.versions.current.id ||
    current !== review.versions.current.version ||
    baseline !== review.versions.saved.version
  ) {
    throw new Error(
      "The linked plan or its review has changed. Reopen this review to draft against the latest version.",
    );
  }
  return commitReviewedDescription(review.ticket, expected);
}

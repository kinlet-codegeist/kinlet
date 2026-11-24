import { type AdfNode } from "./atlassian-text";
import {
  confluenceHandoffPlanPair,
  readHandoffContext,
  type HandoffSource,
} from "./decision-handoff";
import {
  composeReturnedChanges,
  locateReturnedChanges,
  maxReturnedChanges,
  maxReviewReason,
  parsePassage,
  type PassageEdit,
} from "./returned-passages";
import { returnedEditMetadata, type ReturnedEditReview } from "./applied-edits";
import {
  commitReviewedDescription,
  sameText,
  type TicketText,
} from "./jira-checkpoints";
import { latestLinkedCheckpoint } from "./plan-reviews";
import type { DecisionEntry } from "./review-decisions";
import { runtime } from "./runtime";

export const proposalFields = {
  changes: [{ original: "", replacement: "", reason: "" }],
};
export const returnInstructions =
  "Return this JSON with only proposal.changes filled in. Give each independently reviewable edit its own entry. For original, quote one unique passage from ticket.current.description, or leave it empty to append a paragraph. Set replacement to the proposed wording and explain each edit in reason. Include up to 10 edits.";

export type ReturnedProposal = {
  source: "jira" | "sample";
  siteId?: string | null;
  ticketUrl: string | null;
  key: string;
  reviewId: string;
  checkpointId: string;
  pageId: string;
  reviewedVersion: number;
  planVersion: number | null;
  base: TicketText;
  changes: PassageEdit[];
  separateEdits: boolean;
};

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function version(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function publishedPlan(value: unknown): value is { version: number } | null {
  return value === null || (object(value) && version(value.version));
}

export function parseReturnedProposal(text: string): ReturnedProposal {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Paste a JSON handoff or choose its .json file.");
  }
  if (
    !object(data) ||
    data.format !== "kinlet.decision-handoff.v1" ||
    (data.source !== "jira" && data.source !== "sample") ||
    !object(data.ticket) ||
    typeof data.ticket.key !== "string" ||
    !object(data.ticket.current) ||
    typeof data.ticket.current.summary !== "string" ||
    typeof data.ticket.current.description !== "string" ||
    !object(data.review) ||
    typeof data.review.id !== "string" ||
    typeof data.review.checkpointId !== "string" ||
    !object(data.plan) ||
    typeof data.plan.pageId !== "string" ||
    !version(data.plan.reviewedVersion) ||
    !publishedPlan(data.plan.current)
  ) {
    throw new Error(
      "Use the JSON from Prepare handoff. Its ticket, saved review, and plan version are required.",
    );
  }
  const proposal = data.proposal;
  const separateEdits = object(proposal) && "changes" in proposal;
  const changes = separateEdits ? proposal.changes : [proposal];
  if (
    !Array.isArray(changes) ||
    changes.length === 0 ||
    changes.length > maxReturnedChanges
  )
    throw new Error(
      "Return between 1 and " +
        maxReturnedChanges +
        " independently reviewable edits.",
    );
  return {
    source: data.source,
    key: data.ticket.key,
    siteId: typeof data.siteId === "string" ? data.siteId : null,
    ticketUrl: typeof data.ticket.url === "string" ? data.ticket.url : null,
    reviewId: data.review.id,
    checkpointId: data.review.checkpointId,
    pageId: data.plan.pageId,
    reviewedVersion: data.plan.reviewedVersion,
    planVersion: data.plan.current?.version ?? null,
    base: {
      summary: data.ticket.current.summary,
      description: data.ticket.current.description,
    },
    changes: changes.map(parsePassage),
    separateEdits,
  };
}

function projectMatches(proposal: ReturnedProposal, source: HandoffSource) {
  if (proposal.source !== source.kind || proposal.key !== source.key)
    return false;
  if (source.kind === "sample") return true;
  if (proposal.siteId) return proposal.siteId === runtime.cloudId;
  // Older handoffs include the native Jira URL instead of a cloud ID.
  return (
    !!runtime.siteUrl &&
    proposal.ticketUrl ===
      new URL("/browse/" + encodeURIComponent(source.key), runtime.siteUrl).href
  );
}

// An interrupted response or a second import may see the completed edit already in Jira.
function matchesReturnedText(proposal: ReturnedProposal, current: TicketText) {
  const {
    base,
    changes: [change],
  } = proposal;
  if (
    base.summary !== current.summary ||
    base.description === current.description
  )
    return false;
  if (!change.original) {
    const joined = base.description + "\n" + change.replacement;
    return (
      current.description === joined ||
      (!base.description && current.description === change.replacement)
    );
  }
  const first = base.description.indexOf(change.original);
  return (
    first >= 0 &&
    base.description.indexOf(change.original, first + 1) < 0 &&
    base.description.replace(change.original, () => change.replacement) ===
      current.description
  );
}

export async function inspectReturnedProposal(
  source: HandoffSource,
  entry: DecisionEntry,
  proposal: ReturnedProposal,
) {
  if (
    !projectMatches(proposal, source) ||
    proposal.reviewId !== entry.id ||
    proposal.checkpointId !== entry.checkpointId ||
    proposal.pageId !== entry.pageId ||
    proposal.reviewedVersion !== entry.version
  )
    throw new Error(
      "This proposal belongs to a different ticket, site, or saved review. Open its original decision.",
    );
  const context = await readHandoffContext(source, entry);
  const live = context.evidence;
  const problems: string[] = [];
  const notices: string[] = [];
  const planVersion = live.plan.current?.version;
  const link = context.ticket
    ? await latestLinkedCheckpoint(context.ticket)
    : undefined;
  if (
    context.ticket &&
    (!link ||
      link.plan.cloudId !== runtime.cloudId ||
      link.plan.id !== entry.pageId)
  )
    problems.push(
      "The ticket no longer tracks the plan used for this handoff.",
    );
  const planChanged = planVersion !== proposal.planVersion;
  if (
    !planVersion ||
    !proposal.planVersion ||
    proposal.planVersion < entry.version ||
    proposal.planVersion > planVersion
  )
    problems.push(
      "The published plan version could not be verified for both the handoff and this review.",
    );
  const alreadyApplied =
    !proposal.separateEdits &&
    matchesReturnedText(proposal, live.ticket.current);
  const ticketChanged = !sameText(live.ticket.current, proposal.base);
  if (!alreadyApplied && ticketChanged)
    notices.push("The ticket wording changed since the handoff.");
  const needsSelection = proposal.separateEdits || planChanged || ticketChanged;
  let plan: Awaited<ReturnType<typeof confluenceHandoffPlanPair>> | undefined;
  if (
    !problems.length &&
    !alreadyApplied &&
    planChanged &&
    proposal.planVersion &&
    planVersion
  ) {
    notices.push(
      "The handoff used plan v" +
        proposal.planVersion +
        ". The published plan is now v" +
        planVersion +
        ".",
    );
    try {
      plan = await confluenceHandoffPlanPair(
        source,
        entry,
        proposal.planVersion,
        planVersion,
      );
    } catch (error) {
      problems.push(
        error instanceof Error
          ? error.message
          : "Couldn’t verify both versions of the plan.",
      );
    }
  }
  let expected: AdfNode | null = null;
  const choices =
    problems.length || alreadyApplied
      ? []
      : locateReturnedChanges(
          context.descriptionDoc,
          proposal.changes,
          needsSelection,
        );
  if (choices.length && !needsSelection) {
    try {
      expected = composeReturnedChanges(context.descriptionDoc, choices, [0]);
    } catch (error) {
      problems.push(
        error instanceof Error
          ? error.message
          : "Couldn’t locate the proposed passage.",
      );
    }
  }
  return {
    context,
    expected,
    problems,
    notices,
    alreadyApplied,
    needsSelection,
    choices,
    plan,
    trackedCheckpoint: link?.checkpointId,
  };
}

export type ProposalPreview = Awaited<
  ReturnType<typeof inspectReturnedProposal>
>;
export type ProposalSelection = { kept: number[]; reason: string };

export function selectedProposalDocument(
  preview: ProposalPreview,
  selection: ProposalSelection,
) {
  if (
    !preview.needsSelection ||
    preview.problems.length ||
    !selection.kept.length
  )
    return null;
  return composeReturnedChanges(
    preview.context.descriptionDoc,
    preview.choices,
    selection.kept,
  );
}

export async function applyReturnedProposal(
  source: HandoffSource,
  entry: DecisionEntry,
  proposal: ReturnedProposal,
  reviewed: ProposalPreview,
  selection?: ProposalSelection,
) {
  const reason = selection?.reason.trim() ?? "";
  if (selection && (!reason || reason.length > maxReviewReason))
    throw new Error(
      "Enter a reason of up to " +
        maxReviewReason +
        " characters for your selection.",
    );
  const expected = selection
    ? selectedProposalDocument(reviewed, selection)
    : reviewed.expected;
  if (!expected)
    throw new Error("Review the proposal against the current ticket first.");

  const fresh = await inspectReturnedProposal(source, entry, proposal);
  const planVersion = reviewed.context.evidence.plan.current?.version;
  if (
    !planVersion ||
    !proposal.planVersion ||
    fresh.problems.length ||
    planVersion !== fresh.context.evidence.plan.current?.version ||
    fresh.trackedCheckpoint !== reviewed.trackedCheckpoint ||
    fresh.context.ticket?.id !== reviewed.context.ticket?.id ||
    !sameText(
      fresh.context.evidence.ticket.current,
      reviewed.context.evidence.ticket.current,
    ) ||
    JSON.stringify(fresh.context.descriptionDoc) !==
      JSON.stringify(reviewed.context.descriptionDoc) ||
    JSON.stringify(fresh.context.evidence.review) !==
      JSON.stringify(reviewed.context.evidence.review) ||
    JSON.stringify(fresh.plan) !== JSON.stringify(reviewed.plan)
  )
    throw new Error(
      [
        ...fresh.problems,
        "The ticket or plan changed. Preview the edit again.",
      ].join(" "),
    );

  const review: ReturnedEditReview | undefined = selection
    ? {
        changes: proposal.changes,
        kept: [...new Set(selection.kept)].sort((a, b) => a - b),
        proposalPlanVersion: proposal.planVersion,
        reason,
      }
    : undefined;
  const change = proposal.changes[review?.kept[0] ?? 0];
  if (source.kind === "sample") {
    source.applyReturnedEdit(expected, {
      ...change,
      review,
      id: crypto.randomUUID(),
      reviewId: entry.id,
      planVersion,
      author: "Ricardo López (sample)",
      created: new Date().toISOString(),
    });
    return null;
  }
  if (!fresh.context.ticket) throw new Error("Reopen the ticket in Jira.");
  return commitReviewedDescription(
    fresh.context.ticket,
    expected,
    returnedEditMetadata(
      fresh.context.ticket.id,
      entry,
      planVersion,
      change,
      review,
    ),
  );
}

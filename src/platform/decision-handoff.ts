import { decisionLabels } from "../domain/decision-search";
import {
  readPinnedPlan,
  readPlanHead,
  type PlanVersion,
} from "./confluence-plan";
import type { AdfNode } from "./atlassian-text";
import type { AppliedEdit } from "./applied-edits";
import type { Ticket, TicketText } from "./jira-checkpoints";
import { readReviewedTicket, type DecisionEntry } from "./review-decisions";
import { runtime } from "./runtime";

type PlanHead = Pick<PlanVersion, "title" | "version">;
export type SampleHandoffSource = {
  kind: "sample";
  key: string;
  ticket: TicketText;
  descriptionDoc: AdfNode | null;
  appliedEdits: AppliedEdit[];
  applyReturnedEdit: (doc: AdfNode, edit: AppliedEdit) => void;
  plan: PlanHead & { id: string };
  readPlanVersion: (version: number) => Promise<PlanVersion>;
};
export type HandoffSource =
  | SampleHandoffSource
  | { kind: "jira"; key: string; onTicketUpdated?: (ticket: Ticket) => void };

function evidence(
  source: HandoffSource["kind"],
  key: string,
  ticket: TicketText,
  entry: DecisionEntry,
  head: PlanHead | null,
  site?: string,
) {
  const origin = site && new URL(site).origin;
  return {
    source,
    ticket: {
      key,
      url: origin ? origin + "/browse/" + encodeURIComponent(key) : null,
      current: { summary: ticket.summary, description: ticket.description },
    },
    review: {
      id: entry.id,
      url: origin
        ? origin +
          "/rest/api/3/attachment/content/" +
          encodeURIComponent(entry.id)
        : null,
      checkpointId: entry.checkpointId,
      reviewer: entry.author,
      recordedAt: entry.created,
      outcome: entry.decision?.outcome ?? null,
      reason: entry.decision?.reason ?? null,
      ticketAtReview: entry.decision?.wording ?? null,
    },
    plan: {
      pageId: entry.pageId,
      url: origin
        ? origin +
          "/wiki/pages/viewpage.action?pageId=" +
          encodeURIComponent(entry.pageId)
        : null,
      fromVersion: entry.decision?.fromVersion ?? null,
      reviewedVersion: entry.version,
      current: head && { title: head.title, version: head.version },
    },
  };
}

export async function readHandoffContext(
  source: HandoffSource,
  selected: DecisionEntry,
) {
  if (source.kind === "sample") {
    return {
      ticket: null,
      descriptionDoc: source.descriptionDoc,
      evidence: evidence(
        source.kind,
        source.key,
        source.ticket,
        selected,
        source.plan.id === selected.pageId ? source.plan : null,
      ),
    };
  }
  const { ticket, entry } = await readReviewedTicket(source.key, selected.id);
  const head = runtime.cloudId
    ? await readPlanHead({
        id: entry.pageId,
        version: entry.version,
        cloudId: runtime.cloudId,
      }).catch(() => null)
    : null;
  return {
    ticket,
    descriptionDoc: ticket.descriptionDoc,
    evidence: evidence(
      source.kind,
      ticket.key,
      ticket,
      entry,
      head,
      runtime.siteUrl,
    ),
  };
}

export async function confluenceHandoffPlanPair(
  source: HandoffSource,
  entry: DecisionEntry,
  old: number,
  current: number,
) {
  const read = (version: number) =>
    source.kind === "sample"
      ? source.readPlanVersion(version)
      : readPinnedPlan({
          id: entry.pageId,
          cloudId: runtime.cloudId ?? "",
          version,
        });
  const [saved, latest] = await Promise.all([read(old), read(current)]);
  if (
    saved.id !== entry.pageId ||
    latest.id !== entry.pageId ||
    saved.version !== old ||
    latest.version !== current
  )
    throw new Error(
      "Couldn’t verify both published versions of the linked plan.",
    );
  return { saved, current: latest };
}

export async function readHandoffEvidence(
  source: HandoffSource,
  selected: DecisionEntry,
) {
  return (await readHandoffContext(source, selected)).evidence;
}

export type HandoffEvidence = Awaited<ReturnType<typeof readHandoffEvidence>>;
export type HandoffPreview = { evidence: HandoffEvidence; checkedAt: string };

export function handoffText(
  { evidence, checkedAt }: HandoffPreview,
  nextTask: string,
) {
  const { ticket, review, plan } = evidence;
  const old = review.ticketAtReview;
  const changed =
    old &&
    (["summary", "description"] as const).filter(
      (field) => old[field] !== ticket.current[field],
    );
  const lines = [
    (evidence.source === "sample"
      ? "Sample decision handoff"
      : "Decision handoff") +
      " · " +
      ticket.key,
    "Sources checked: " + checkedAt,
    "",
  ];
  if (nextTask.trim()) lines.push("Next task", nextTask.trim(), "");
  lines.push(
    "Recorded decision",
    review.outcome ? decisionLabels[review.outcome] : "Marked reviewed",
    "Reviewer: " + review.reviewer,
    "Recorded: " + review.recordedAt,
    "Reason: " + (review.reason ?? "No reason was recorded in this review."),
    "",
    "Linked plan",
    "Reviewed: " +
      (plan.fromVersion ? "v" + plan.fromVersion + " → " : "") +
      "v" +
      plan.reviewedVersion,
  );
  if (plan.current) {
    lines.push(
      "Published at handoff: v" +
        plan.current.version +
        " · " +
        plan.current.title,
    );
    if (plan.current.version > plan.reviewedVersion)
      lines.push(
        "Review the newer plan before carrying this decision forward.",
      );
  } else lines.push("Current published version unavailable.");
  lines.push("", "Ticket wording");
  if (!old)
    lines.push("The earlier review did not capture the ticket wording.");
  else if (changed?.length) {
    lines.push(
      "Changed since review: " + changed.join(" and ") + ".",
      "At review",
      old.summary,
      old.description || "(No description)",
      "",
    );
  } else lines.push("The summary and description match the saved review.");
  lines.push(
    "Current",
    ticket.current.summary,
    ticket.current.description || "(No description)",
    "",
    "Sources",
    "Ticket: " + (ticket.url ?? ticket.key),
    "Review record: " + (review.url ?? review.id),
    "Checkpoint reference: " + review.checkpointId,
    "Plan page: " + (plan.url ?? plan.pageId),
  );
  lines.push(
    "",
    "To propose a description edit, fill in the proposal fields in the JSON handoff and return it to the reviewer.",
  );
  return lines.join("\n");
}

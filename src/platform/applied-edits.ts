import { issueChanges, type IssueHistoryMetadata } from "./jira-checkpoints";
import { readReviewedTicket, type DecisionEntry } from "./review-decisions";

import {
  maxReturnedChanges,
  maxReviewReason,
  parsePassage,
  type PassageEdit,
} from "./returned-passages";

export type ReturnedEditReview = {
  changes: PassageEdit[];
  kept: number[];
  reason: string;
  proposalPlanVersion: number;
};
export type AppliedEdit = PassageEdit & {
  id: string;
  reviewId: string;
  planVersion: number;
  review?: ReturnedEditReview;
  author: string;
  created: string;
};

const metadataType = "kinlet:returned-edit:v1";
const reviewMetadataType = "kinlet:returned-edit:v2";

export function returnedEditMetadata(
  issueId: string,
  entry: DecisionEntry,
  planVersion: number,
  change: PassageEdit,
  review?: ReturnedEditReview,
): IssueHistoryMetadata {
  return {
    type: review ? reviewMetadataType : metadataType,
    activityDescription: "Applied a returned edit in Kinlet",
    extraData: {
      issueId,
      reviewId: entry.id,
      checkpointId: entry.checkpointId,
      pageId: entry.pageId,
      reviewedVersion: String(entry.version),
      planVersion: String(planVersion),
      ...(review ? { selection: JSON.stringify(review) } : change),
    },
  };
}

function readSelection(
  raw: string | undefined,
  planVersion: number,
): ReturnedEditReview | undefined {
  if (!raw) return;
  try {
    const data = JSON.parse(raw) as Partial<ReturnedEditReview>;
    if (
      !Array.isArray(data.changes) ||
      !data.changes.length ||
      data.changes.length > maxReturnedChanges ||
      !Array.isArray(data.kept) ||
      !data.kept.length ||
      data.kept.some(
        (i) => !Number.isSafeInteger(i) || i < 0 || i >= data.changes!.length,
      ) ||
      typeof data.reason !== "string" ||
      !data.reason.trim() ||
      data.reason.length > maxReviewReason ||
      typeof data.proposalPlanVersion !== "number" ||
      !Number.isSafeInteger(data.proposalPlanVersion) ||
      data.proposalPlanVersion < 1 ||
      data.proposalPlanVersion > planVersion
    )
      return;
    return {
      changes: data.changes.map(parsePassage),
      kept: data.kept,
      reason: data.reason,
      proposalPlanVersion: data.proposalPlanVersion,
    };
  } catch {
    return;
  }
}

export async function readAppliedEdits(
  key: string,
  reviewId: string,
  signal: AbortSignal,
) {
  const { ticket, entry } = await readReviewedTicket(key, reviewId);
  const edits = new Map<string, AppliedEdit>();
  let incomplete = 0;
  for await (const page of issueChanges(ticket.id, signal)) {
    for (const event of page) {
      const metadata = event.historyMetadata;
      const data = metadata?.extraData;
      if (
        (metadata?.type !== metadataType &&
          metadata?.type !== reviewMetadataType) ||
        !data ||
        data.reviewId !== entry.id
      )
        continue;
      const planVersion = Number(data.planVersion);
      const review =
        metadata.type === reviewMetadataType
          ? readSelection(data.selection, planVersion)
          : undefined;
      const first = review
        ? review.changes[review.kept[0]]
        : {
            original: data.original,
            replacement: data.replacement,
            reason: typeof data.reason === "string" ? data.reason : "",
          };
      if (
        data.issueId !== ticket.id ||
        data.checkpointId !== entry.checkpointId ||
        data.pageId !== entry.pageId ||
        data.reviewedVersion !== String(entry.version) ||
        !Number.isSafeInteger(planVersion) ||
        planVersion < 1 ||
        !event.items?.some(
          (item) =>
            item.fieldId === "description" ||
            item.field?.toLowerCase() === "description",
        ) ||
        !event.id ||
        !Number.isFinite(Date.parse(event.created)) ||
        (metadata.type === reviewMetadataType && !review) ||
        typeof first.original !== "string" ||
        typeof first.replacement !== "string" ||
        first.original === first.replacement
      ) {
        incomplete++;
        continue;
      }
      edits.set(event.id, {
        id: event.id,
        reviewId: entry.id,
        planVersion,
        ...first,
        review,
        author: event.author?.displayName || "Editor unavailable",
        created: event.created,
      });
    }
  }
  return {
    edits: [...edits.values()].sort(
      (a, b) =>
        Date.parse(b.created) - Date.parse(a.created) ||
        b.id.localeCompare(a.id, undefined, { numeric: true }),
    ),
    incomplete,
  };
}

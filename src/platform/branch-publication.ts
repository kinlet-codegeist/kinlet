import { descriptionUpdate } from "../domain/description-update";
import type { AdfNode } from "./atlassian-text";
import type { PlanReference } from "./confluence-plan";
import {
  sameText,
  type TicketText,
  type TicketFieldUpdate,
} from "./jira-checkpoints";
import type { BranchRevision } from "./ticket-branches";

export const ticketFields = ["summary", "description"] as const;
export type TicketField = (typeof ticketFields)[number];
export type BranchBase = TicketText & { plan?: PlanReference };
export type PublicationTicket = TicketText & {
  id: string;
  key: string;
  descriptionDoc: AdfNode | null;
};
export type BranchReview = {
  base: BranchBase;
  revision: BranchRevision;
  live: PublicationTicket;
};
export type BranchPublication = {
  review: (revision: BranchRevision) => Promise<BranchReview>;
  apply: (
    preview: BranchReview,
    selected: TicketField[],
  ) => Promise<TicketField[]>;
};

export function wordingStatus(base: string, draft: string, live: string) {
  if (draft === base) return live === base ? "unchanged" : "ticketOnly";
  if (live === draft) return "matches";
  return live === base ? "ready" : "conflict";
}

export function branchField(review: BranchReview, field: TicketField) {
  const { base, revision, live } = review;
  const status = wordingStatus(base[field], revision[field], live[field]);
  if (status !== "ready" && status !== "conflict") return { status } as const;
  const update =
    field === "description"
      ? descriptionUpdate(live.descriptionDoc, revision.description)
      : { summary: revision.summary };
  if (!update) return { status: "formatted" } as const;
  return {
    status,
    update,
  } as const;
}

export function branchPublication(
  review: BranchPublication["review"],
  write: (
    source: BranchReview,
    fields: TicketFieldUpdate,
  ) => Promise<TicketField[]>,
): BranchPublication {
  return {
    review,
    async apply(preview, selected) {
      const fresh = await review(preview.revision);
      if (
        fresh.live.id !== preview.live.id ||
        fresh.live.key !== preview.live.key ||
        fresh.revision.revisionId !== preview.revision.revisionId ||
        !sameText(fresh.revision, preview.revision) ||
        !sameText(fresh.base, preview.base) ||
        JSON.stringify(fresh.base.plan) !== JSON.stringify(preview.base.plan)
      )
        throw new Error(
          "The review sources changed. Review the revision again.",
        );
      const fields: TicketFieldUpdate = {};
      for (const field of selected) {
        const choice = branchField(preview, field);
        if (!choice.update)
          throw new Error("Review the selected fields again.");
        if (fresh.live[field] === preview.revision[field]) continue;
        if (
          fresh.live[field] !== preview.live[field] ||
          (field === "description" &&
            JSON.stringify(fresh.live.descriptionDoc) !==
              JSON.stringify(preview.live.descriptionDoc))
        )
          throw new Error(
            "The ticket changed after this review opened. Refresh the review and choose the fields again.",
          );
        Object.assign(fields, choice.update);
      }
      return Object.keys(fields).length ? write(fresh, fields) : [];
    },
  };
}

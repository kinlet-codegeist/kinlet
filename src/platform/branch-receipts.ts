import type { BranchReview, TicketField } from "./branch-publication";
import type { IssueChange } from "./jira-checkpoints";
import type { BranchRevision } from "./ticket-branches";

export const branchPublicationType = "kinlet:branch-publication:v1";

export type PublishedField = {
  field: TicketField;
  before: string | null;
  after: string | null;
};
export type PublicationReceipt = {
  id: string;
  created: string;
  author: string;
  changes: PublishedField[];
};
export type PublicationHistory = {
  review: BranchReview;
  receipts: PublicationReceipt[];
  incomplete: number;
};

// Read native field changes so older publications and partial selections are
// attributed exactly as Jira recorded them.
export async function collectBranchReceipts(
  revision: BranchRevision,
  pages: AsyncIterable<IssueChange[]>,
): Promise<Pick<PublicationHistory, "receipts" | "incomplete">> {
  const receipts = new Map<string, PublicationReceipt>();
  let incomplete = 0;
  for await (const page of pages) {
    for (const event of page) {
      const metadata = event.historyMetadata;
      const data = metadata?.extraData;
      if (
        metadata?.type !== branchPublicationType ||
        !data ||
        data.revisionId !== revision.revisionId ||
        data.branchId !== revision.branchId ||
        data.checkpointId !== revision.checkpointId
      )
        continue;
      if (
        !event.id ||
        !Number.isFinite(Date.parse(event.created)) ||
        !Array.isArray(event.items)
      ) {
        incomplete++;
        continue;
      }
      const changes: PublishedField[] = [];
      for (const item of event.items) {
        if (item.fieldtype && item.fieldtype !== "jira") continue;
        const field = item.fieldId || item.field?.toLowerCase();
        if (field !== "summary" && field !== "description") continue;
        changes.push({
          field,
          before: typeof item.fromString === "string" ? item.fromString : null,
          after: typeof item.toString === "string" ? item.toString : null,
        });
      }
      if (!changes.length) {
        incomplete++;
        continue;
      }
      receipts.set(event.id, {
        id: event.id,
        created: event.created,
        author: event.author?.displayName || "Editor unavailable",
        changes,
      });
    }
  }
  return {
    receipts: [...receipts.values()].sort(
      (a, b) =>
        Date.parse(b.created) - Date.parse(a.created) ||
        b.id.localeCompare(a.id, undefined, { numeric: true }),
    ),
    incomplete,
  };
}

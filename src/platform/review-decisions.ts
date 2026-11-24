import {
  readAttachmentJson,
  readTicket,
  type CheckpointFile,
  type IndexedTicket,
} from "./jira-checkpoints";
import { runtime } from "./runtime";

import {
  decisionFiles,
  readDecisionRecord,
  type DecisionHistory,
  type ReceiptFile,
} from "../domain/decision-records";
export {
  maxReasonLength,
  validDecision,
  type DecisionEntry,
  type DecisionHistory,
  type DecisionInput,
  type DecisionOutcome,
} from "../domain/decision-records";

export function reviewFiles(ticket: IndexedTicket) {
  return decisionFiles(ticket.reviews);
}

export async function readReviewedTicket(key: string, reviewId: string) {
  const ticket = await readTicket(key);
  const file = reviewFiles(ticket).find((ref) => ref.file.id === reviewId);
  const entry = file && (await readDecisionEntry(ticket, file));
  if (!entry)
    throw new Error(
      "This review is no longer available on the ticket. Reopen Decision history to see the available reviews.",
    );
  return { ticket, entry };
}

export async function readDecisionEntry(
  ticket: IndexedTicket,
  ref: ReceiptFile,
) {
  return readDecisionRecord(
    ref,
    ticket.id,
    runtime.cloudId,
    readAttachmentJson,
  );
}

export async function ticketDecisions(
  ticket: IndexedTicket,
  signal: AbortSignal,
  versions?: ReadonlySet<number>,
): Promise<DecisionHistory> {
  const result: DecisionHistory = { entries: [], unavailable: 0 };
  const newestFirst = (a: CheckpointFile, b: CheckpointFile) =>
    Date.parse(b.created) - Date.parse(a.created) ||
    b.id.localeCompare(a.id, undefined, { numeric: true });
  const files = reviewFiles(ticket)
    .filter((ref) => !versions?.size || versions.has(ref.version))
    .sort((a, b) => newestFirst(a.file, b.file));
  const seen = new Set<string>();
  for (let i = 0; i < files.length && !signal.aborted; i += 4) {
    const batch = files.slice(i, i + 4);
    const results = await Promise.allSettled(
      batch.map((ref) => readDecisionEntry(ticket, ref)),
    );
    for (const [j, read] of results.entries()) {
      if (read.status !== "fulfilled" || !read.value) {
        result.unavailable++;
        continue;
      }
      const filename = batch[j].file.filename;
      // A retried upload represents the same operation. Legacy receipts had no operation ID.
      if (batch[j].requestId && seen.has(filename)) continue;
      seen.add(filename);
      result.entries.push(read.value);
    }
  }
  return result;
}

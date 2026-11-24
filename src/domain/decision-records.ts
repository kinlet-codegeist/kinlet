import type { CheckpointFile, TicketText } from "../platform/jira-checkpoints";

export const maxReasonLength = 600;
export type DecisionOutcome = "kept" | "updated";
export type DecisionInput = { outcome: DecisionOutcome; reason: string };
export type DecisionEntry = {
  id: string;
  checkpointId: string;
  pageId: string;
  version: number;
  author: string;
  created: string;
  decision?: DecisionInput & { fromVersion: number; wording: TicketText };
};
export type DecisionHistory = { entries: DecisionEntry[]; unavailable: number };

const filePattern =
  /^kinlet-review-([1-9]\d*)-v([1-9]\d*)(?:-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?\.json$/;
export function decisionFiles(files: CheckpointFile[]) {
  return files.flatMap((file) => {
    const match = filePattern.exec(file.filename);
    if (!match || !Number.isSafeInteger(Number(match[2]))) return [];
    return [
      {
        file,
        checkpointId: match[1],
        version: Number(match[2]),
        requestId: match[3] as string | undefined,
      },
    ];
  });
}
export type ReceiptFile = ReturnType<typeof decisionFiles>[number];

export function validDecision(value: unknown): value is DecisionInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<DecisionInput>;
  return (
    (input.outcome === "kept" || input.outcome === "updated") &&
    typeof input.reason === "string" &&
    !!input.reason.trim() &&
    input.reason.length <= maxReasonLength
  );
}

type StoredDecision = {
  format?: string;
  issueId?: string;
  cloudId?: string;
  checkpointId?: string;
  version?: number;
  pageId?: string;
  requestId?: string;
  decision?: unknown;
  fromVersion?: number;
  wording?: Partial<TicketText>;
};

export async function readDecisionRecord(
  ref: ReceiptFile,
  issueId: string,
  cloudId: string | undefined,
  load: (file: CheckpointFile) => Promise<unknown>,
): Promise<DecisionEntry | undefined> {
  if (!cloudId || ref.file.size > (ref.requestId ? 1024 * 1024 : 4096)) return;
  const record = (await load(ref.file)) as StoredDecision | null;
  if (
    !record ||
    record.issueId !== issueId ||
    record.checkpointId !== ref.checkpointId ||
    record.version !== ref.version ||
    typeof record.pageId !== "string" ||
    !/^[1-9]\d*$/.test(record.pageId) ||
    record.cloudId !== cloudId
  )
    return;
  const entry: DecisionEntry = {
    id: ref.file.id,
    checkpointId: ref.checkpointId,
    pageId: record.pageId,
    version: ref.version,
    author: ref.file.author?.displayName || "Jira user",
    created: ref.file.created,
  };
  if (record.format === "kinlet.review.v1" && !ref.requestId) return entry;
  if (
    record.format !== "kinlet.review.v2" ||
    !ref.requestId ||
    record.requestId !== ref.requestId ||
    !validDecision(record.decision) ||
    typeof record.fromVersion !== "number" ||
    !Number.isSafeInteger(record.fromVersion) ||
    record.fromVersion < 1 ||
    record.fromVersion >= record.version ||
    typeof record.wording?.summary !== "string" ||
    typeof record.wording?.description !== "string"
  )
    return;
  return {
    ...entry,
    decision: {
      outcome: record.decision.outcome,
      reason: record.decision.reason,
      fromVersion: record.fromVersion,
      wording: {
        summary: record.wording.summary,
        description: record.wording.description,
      },
    },
  };
}

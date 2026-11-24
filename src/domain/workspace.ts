import type { AdfNode } from "../platform/atlassian-text";

export const workspaceLimits = {
  issues: 20,
  pages: 5,
  sourceBytes: 128 * 1024,
  draftBytes: 128 * 1024,
};
export type SourceRef = { kind: "jira" | "confluence"; id: string };
export type SourceVersion = {
  source: SourceRef;
  key: string;
  title: string;
  body: AdfNode | null;
  version: string;
  status?: string;
  priority?: { id: string; name: string };
  related?: Array<{ id: string; key: string; type: string }>;
};
export type Scope = { sources: SourceRef[]; revision: number };
export type Checkpoint = {
  id: string;
  name: string;
  startedAt: string;
  finishedAt?: string;
  author: string;
  sources: SourceRef[];
};
export type CheckpointSummary = Omit<Checkpoint, "sources"> & {
  sourceCount: number;
};
export type Coverage = {
  sources: Array<{
    source: SourceRef;
    label: string;
    status: Observation["status"];
  }>;
  unavailable: number;
};
export type Observation =
  | { status: "captured"; version: SourceVersion }
  | { status: "unavailable" | "too_large" | "pending" };

export type DraftChange = {
  source: SourceRef;
  title?: string;
  body?: string;
  priorityId?: string;
  citations?: Partial<Record<ReviewField, Citation[]>>;
  disputed?: ReviewField[];
};
export const reviewFields = ["title", "body", "priority"] as const;
export type ReviewField = (typeof reviewFields)[number];
export type Citation = {
  source: SourceRef;
  quote: string;
  required: boolean;
  version?: string;
};
export type CitationReview = {
  status: "current" | "changed" | "ambiguous" | "unavailable";
  required: boolean;
  source?: SourceRef;
  label?: string;
  quote?: string;
  savedVersion?: string;
  version?: string;
};
export type ReviewTemplate = {
  id: string;
  revision: number;
  name: string;
  instructions: string;
  evidenceFor: ReviewField[];
  approval: "editors" | "admins";
};
export const defaultReviewTemplates: ReviewTemplate[] = [
  {
    id: "requirement",
    revision: 0,
    name: "Requirement change",
    instructions:
      "Cite the current requirement and the acceptance checks it affects.",
    evidenceFor: ["body"],
    approval: "editors",
  },
  {
    id: "bug",
    revision: 0,
    name: "Bug fix",
    instructions: "Cite the reported behavior and the expected result.",
    evidenceFor: ["body"],
    approval: "editors",
  },
  {
    id: "runbook",
    revision: 0,
    name: "Documentation update",
    instructions:
      "Cite the existing runbook passage and the decision that changes it.",
    evidenceFor: ["body"],
    approval: "editors",
  },
];
export type DecisionOrigin = { project: string; publicationId: string };
export type BitbucketEvidence = {
  url: string;
  commit: string;
  observedAt: string;
  statuses: Array<{
    key: string;
    state: "SUCCESSFUL" | "FAILED" | "INPROGRESS" | "STOPPED";
  }>;
};
export type RepairScope = {
  proposalId: string;
  source: SourceRef;
  field: ReviewField;
};

export type Branch = {
  id: string;
  name: string;
  checkpointId: string;
  createdAt: string;
  revision: number;
  predecessorId?: string;
  reversalOf?: string;
  requiredEdits?: string[];
  repair?: RepairScope;
  origin?: DecisionOrigin;
  reviewTemplate?: ReviewTemplate;
};
export type BranchRevision = {
  revision: number;
  createdAt: string;
  author: string;
  changes: DraftChange[];
};

export const sourceKey = ({ kind, id }: SourceRef) => kind + ":" + id;
export const validNativeId = (id: unknown): id is string =>
  typeof id === "string" && /^[1-9]\d{0,19}$/.test(id);
export const validRecordId = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id);

export function requireSource(value: unknown): SourceRef {
  if (!value || typeof value !== "object")
    throw new Error("Choose a Jira ticket or Confluence page.");
  const { id, kind } = value as Partial<SourceRef>;
  if ((kind !== "jira" && kind !== "confluence") || !validNativeId(id))
    throw new Error("Choose a Jira ticket or Confluence page.");
  return { kind, id };
}

export function requireName(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100)
    throw new Error("Enter a name of up to 100 characters.");
  return value.trim();
}

export type WorkspaceProposal = {
  id: string;
  name: string;
  branchId: string;
  checkpointId: string;
  revision: number;
  createdAt: string;
  runId?: string;
  changes: DraftChange[];
  template?: ReviewTemplate;
  predecessorId?: string;
  reversalOf?: string;
};
export type ReviewChoice = {
  id: string;
  source: SourceRef;
  label: string;
  field: ReviewField;
  base: string;
  current: string;
  proposed: string;
  conflict: boolean;
  available: boolean;
  evidence: string;
  citations?: CitationReview[];
  hold?:
    | "evidence_changed"
    | "evidence_unavailable"
    | "disputed"
    | "evidence_required";
};
export type PublicationStep = {
  source: SourceRef;
  fields: ReviewField[];
  desired: DraftChange;
  before: string;
  after: string;
  status:
    | "pending"
    | "applied"
    | "already_present"
    | "verification_required"
    | "source_changed";
  version?: string;
  citations?: Citation[];
  previous?: string;
  checkedAt?: string;
};
export type WorkspacePublication = {
  id: string;
  proposalId: string;
  approver: string;
  approvedAt: string;
  reason: string;
  steps: PublicationStep[];
  fieldApproval?: boolean;
  approvalKey?: string;
};

export type WorkspaceRun = {
  id: string;
  branchId: string;
  checkpointId: string;
  revision: number;
  author: string;
  objective: string;
  instructions: string;
  createdAt: string;
  sources?: SourceRef[];
  template?: ReviewTemplate;
  bitbucket?: BitbucketEvidence;
};
export const sessionFormat = "kinlet.codex-session.v1";
export const contextFormat = "kinlet.project-context.v1";
export const sessionEventTypes = [
  "user_message",
  "agent_message",
  "turn_started",
  "turn_completed",
  "tool_completed",
  "files_changed",
  "turn_failed",
] as const;
export type SessionEvent = {
  kind: (typeof sessionEventTypes)[number];
  at: string;
  text?: string;
};
export type SessionExport = {
  format: typeof sessionFormat;
  runId: string;
  threadId: string;
  events: SessionEvent[];
};

export type WorkspaceQuestion = {
  id: string;
  runId: string;
  createdAt: string;
  question: string;
  answer?: string;
};

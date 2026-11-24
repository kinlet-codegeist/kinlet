export type Priority = "Highest" | "High" | "Medium" | "Low";
export type Artifact = {
  id: string;
  key: string;
  kind: "issue" | "page";
  title: string;
  description: string;
  status: string;
  priority: Priority;
  version: number;
  updatedAt: string;
  owner: string;
  category: string;
  editable: boolean;
};
export type Checkpoint = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  author: string;
  kind: "baseline" | "observation" | "commit" | "publication";
  artifacts: Record<string, Artifact>;
  parentId?: string;
  branchId?: string;
};
export type Branch = {
  id: string;
  name: string;
  objective: string;
  baseId: string;
  revision: number;
  draft: Record<string, Artifact>;
  status: "open" | "review" | "published" | "partial" | "archived";
  createdAt: string;
  owner: string;
  color: string;
  commitIds: string[];
};
export type ContextPack = {
  id: string;
  branchId: string;
  revision: number;
  checkpointId: string;
  objective: string;
  instructions: string;
  sourceIds: string[];
  createdAt: string;
  sources: Record<string, Artifact>;
};
export type RunEvent = {
  title: string;
  description: string;
  time: string;
  provenance: "recorded" | "reported";
};
export type Run = {
  id: string;
  provider: "Codex" | "Claude" | "Rovo";
  title: string;
  branchId: string;
  checkpointId: string;
  contextId?: string;
  status: "working" | "waiting" | "review" | "finished";
  createdAt: string;
  events: RunEvent[];
};
export type FieldName = "title" | "description" | "priority";
export type Change = {
  id: string;
  artifactId: string;
  field: FieldName;
  before: string;
  after: string;
};
export type Resolution = {
  choice: "proposal" | "current" | "custom";
  value: string;
};
export type Proposal = {
  id: string;
  title: string;
  summary: string;
  branchId: string;
  runId?: string;
  checkpointId: string;
  changes: Change[];
  createdAt: string;
  status:
    | "submitted"
    | "changes_requested"
    | "publishing"
    | "partial"
    | "published"
    | "rejected";
  resolutions: Record<string, Resolution>;
  receiptId?: string;
};
export type PublicationStep = {
  artifactId: string;
  changes: Array<{ field: FieldName; expected: string; value: string }>;
  status: "pending" | "verified" | "needs_verification";
  error?: string;
  alreadyPresent?: boolean;
};
export type Publication = {
  id: string;
  proposalId: string;
  createdAt: string;
  steps: PublicationStep[];
  status: "prepared" | "running" | "partial" | "complete";
  checkpointId?: string;
};
export type Question = {
  id: string;
  title: string;
  description: string;
  runId: string;
  answer?: string;
};
export type Activity = {
  id: string;
  title: string;
  detail: string;
  at: string;
  kind: "checkpoint" | "branch" | "run" | "review";
};
export type DemoFlags = {
  aiUnavailable: boolean;
  accessLost: boolean;
  partialPublish: boolean;
};
export type WorkspaceState = {
  schemaVersion: 1;
  workspaceName: string;
  objective: string;
  setupDone: boolean;
  artifacts: Record<string, Artifact>;
  checkpoints: Checkpoint[];
  branches: Branch[];
  contexts: ContextPack[];
  runs: Run[];
  proposals: Proposal[];
  publications: Publication[];
  questions: Question[];
  activities: Activity[];
  observedId: string;
  approvedId: string;
  budget: number;
  dismissed: string[];
  pinned: string[];
  flags: DemoFlags;
  settings: { reviewer: string; retention: string; theme: "light" | "dark" };
};
export type AttentionItem = {
  id: string;
  kind: "drift" | "proposal" | "question" | "recovery";
  title: string;
  description: string;
  minutes: number;
  priority: number;
  label: string;
  route: string;
  sourceIds: string[];
  runId?: string;
  mandatory?: boolean;
};

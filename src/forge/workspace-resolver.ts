import api from "@forge/api";
import Resolver, { type Request } from "@forge/resolver";
import {
  requireName,
  requireSource,
  reviewFields,
  sourceKey,
  validNativeId,
  validRecordId,
  workspaceLimits,
  type Branch,
  type BranchRevision,
  type Checkpoint,
  type DraftChange,
  type WorkspaceProposal,
  type WorkspacePublication,
  type WorkspaceRun,
  type Coverage,
  type Observation,
  type Scope,
  type SourceRef,
  type SourceVersion,
} from "../domain/workspace";
import {
  migrateWorkspace,
  projectStore,
  type WorkspaceStore,
} from "./workspace-store";
import {
  canReadSource,
  captureSource,
  fitsWorkspace,
  resolveIssue,
  resolvePage,
  workspacePermissions,
  type UserApi,
} from "./workspace-sources";
import {
  canSeeDraft,
  sourceAccess,
  validateDraftEvidence,
} from "./workspace-evidence";

export const resolver = new Resolver();
export type Actor = {
  id: string;
  project: string;
  canManage: boolean;
  client: UserApi;
  store: WorkspaceStore;
};
type StoredRevision = BranchRevision & { requestId: string };
const scopeId = "current";

async function authorize({ context }: Request): Promise<Actor> {
  const project = String(context.extension?.project?.id ?? "");
  const id = context.accountId;
  if (!validNativeId(project) || typeof id !== "string" || !id)
    throw new Error("Open Kinlet from a Jira project.");
  return authorizeProject(project, id);
}

export async function authorizeProject(
  project: string,
  id: string,
): Promise<Actor> {
  if (!validNativeId(project) || typeof id !== "string" || !id)
    throw new Error("Open Kinlet from a Jira project.");
  const client = api.asUser();
  return {
    id,
    project,
    client,
    canManage: await workspacePermissions(client, project),
    store: projectStore(project),
  };
}

export function command<T>(
  name: string,
  callback: (actor: Actor, payload: Record<string, unknown>) => Promise<T>,
) {
  resolver.define(name, async (request) => {
    const actor = await authorize(request);
    return callback(actor, request.payload ?? {});
  });
}

export function recordId(value: unknown) {
  if (!validRecordId(value))
    throw new Error("Choose an available workspace record.");
  return value;
}

function requireAdmin(actor: Actor) {
  if (!actor.canManage)
    throw new Error("A Jira project administrator must set up this workspace.");
}

export async function required<T>(
  store: WorkspaceStore,
  kind: string,
  id: string,
) {
  const row = await store.get<T>(kind, id);
  if (!row) throw new Error("This workspace record is unavailable.");
  return row;
}

function observationId(checkpoint: string, source: SourceRef) {
  return checkpoint + ":" + sourceKey(source);
}

async function observe(actor: Actor, source: SourceRef): Promise<Observation> {
  try {
    const version = await captureSource(actor.client, actor.project, source);
    if (!fitsWorkspace(version)) return { status: "too_large" };
    return { status: "captured", version };
  } catch {
    return { status: "unavailable" };
  }
}

export async function forEachBatch<T>(
  values: T[],
  callback: (value: T) => Promise<unknown>,
) {
  for (let i = 0; i < values.length; i += 4) {
    await Promise.all(values.slice(i, i + 4).map(callback));
  }
}

function checkpointSummary({ sources, ...checkpoint }: Checkpoint) {
  return { ...checkpoint, sourceCount: sources.length };
}

async function coverage(
  actor: Actor,
  checkpoint: Checkpoint,
): Promise<Coverage> {
  const visible: Coverage = { sources: [], unavailable: 0 };
  await forEachBatch(checkpoint.sources, async (source) => {
    if (!(await canReadSource(actor.client, actor.project, source))) {
      visible.unavailable++;
      return;
    }
    const captured = (
      await actor.store.get<Observation>(
        "observation",
        observationId(checkpoint.id, source),
      )
    )?.data;
    const label =
      captured?.status === "captured"
        ? captured.version.title + " (" + captured.version.key + ")"
        : (source.kind === "jira" ? "Jira ticket " : "Confluence page ") +
          source.id;
    visible.sources.push({
      source,
      label,
      status: captured?.status ?? "pending",
    });
  });
  visible.sources.sort((a, b) => a.label.localeCompare(b.label));
  return visible;
}

command("workspace.coverage", async (actor, payload) => {
  const checkpoint = (
    await required<Checkpoint>(
      actor.store,
      "checkpoint",
      recordId(payload.checkpointId),
    )
  ).data;
  return coverage(actor, checkpoint);
});

command("workspace.load", async (actor) => {
  const store = actor.store;
  const scope = await store.get<Scope>("scope", scopeId);
  const [checkpoints, branches, proposals, publications, runs] =
    await Promise.all([
      store.recent<Checkpoint>("checkpoint"),
      store.recent<Branch>("branch"),
      store.recent<WorkspaceProposal>("proposal"),
      store.recent<WorkspacePublication>("publication"),
      store.recent<WorkspaceRun>("run"),
    ]);
  const read = sourceAccess(actor);
  const visibleProposals = await Promise.all(
    proposals.map(async ({ data }) => {
      const visible = (
        await Promise.all(
          data.changes.map((change) => canSeeDraft(change, read)),
        )
      ).every(Boolean);
      return {
        id: data.id,
        name: visible ? data.name : "Review proposal",
        createdAt: data.createdAt,
      };
    }),
  );
  return {
    canManage: actor.canManage,
    scope: scope
      ? { ...scope.data, sources: actor.canManage ? scope.data.sources : [] }
      : null,
    checkpoints: checkpoints.map((row) => checkpointSummary(row.data)),
    branches: branches.map((row) => row.data),
    runs: runs.map(({ data }) => ({
      id: data.id,
      branchId: data.branchId,
      createdAt: data.createdAt,
    })),
    proposals: visibleProposals,
    publications: publications.map(({ data }) => ({
      id: data.id,
      proposalId: data.proposalId,
      approvedAt: data.approvedAt,
      steps: data.steps.map((step) => step.status),
    })),
  };
});

command("workspace.initialize", async (actor) => {
  requireAdmin(actor);
  await migrateWorkspace();
  return { ready: true };
});

command("workspace.saveScope", async (actor, payload) => {
  requireAdmin(actor);
  const { issues, pages, revision } = payload;
  if (
    !Array.isArray(issues) ||
    issues.length > workspaceLimits.issues ||
    !Array.isArray(pages) ||
    pages.length > workspaceLimits.pages ||
    (!issues.length && !pages.length) ||
    !issues.every(
      (key) =>
        typeof key === "string" &&
        /^[A-Z][A-Z0-9_]{0,29}-[1-9]\d{0,11}$/.test(key),
    ) ||
    !pages.every(validNativeId)
  ) {
    throw new Error(
      "Choose up to 20 Jira ticket keys and 5 Confluence page IDs.",
    );
  }
  const sources: SourceRef[] = [];
  await forEachBatch(issues as string[], async (key) => {
    const issue = await resolveIssue(actor.client, actor.project, key);
    sources.push({ kind: "jira", id: String(issue.id) });
  });
  await forEachBatch(pages as string[], async (id) => {
    await resolvePage(actor.client, id);
    sources.push({ kind: "confluence", id });
  });
  const deduplicated = [
    ...new Map(sources.map((source) => [sourceKey(source), source])).values(),
  ].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b)));
  const current = await actor.store.get<Scope>("scope", scopeId);
  const seq = current?.seq ?? 0;
  if (seq !== revision)
    throw new Error("The source list changed. Reload it before saving.");
  const scope = { sources: deduplicated, revision: seq + 1 };
  const saved = current
    ? await actor.store.replace("scope", scopeId, seq, scope)
    : await actor.store.insert("scope", scopeId, scope);
  if (!saved)
    throw new Error("The source list changed. Reload it before saving.");
  return scope;
});

export async function saveProjectCheckpoint(
  actor: Actor,
  payload: Record<string, unknown>,
  sources?: SourceRef[],
) {
  const id = recordId(payload.requestId);
  const name = requireName(payload.name);
  return saveCheckpoint(
    actor,
    id,
    name,
    sources ??
      (await required<Scope>(actor.store, "scope", scopeId)).data.sources,
  );
}

export async function saveCapturedCheckpoint(
  actor: Actor,
  id: string,
  name: string,
  captured: SourceVersion[],
) {
  const versions = new Map(
    captured.map((item) => [sourceKey(item.source), item]),
  );
  return saveCheckpoint(
    actor,
    id,
    name,
    captured.map(({ source }) => source),
    versions,
  );
}

async function saveCheckpoint(
  actor: Actor,
  id: string,
  name: string,
  sources: SourceRef[],
  captured?: Map<string, SourceVersion>,
) {
  const initial: Checkpoint = {
    id,
    name,
    startedAt: new Date().toISOString(),
    author: actor.id,
    sources,
  };
  await actor.store.insert("checkpoint", id, initial);
  const existing = await required<Checkpoint>(actor.store, "checkpoint", id);
  const checkpoint = existing.data;
  if (
    checkpoint.author !== actor.id ||
    checkpoint.name !== name ||
    (captured && JSON.stringify(checkpoint.sources) !== JSON.stringify(sources))
  )
    throw new Error("This capture request is already in use.");
  if (checkpoint.finishedAt) return checkpointSummary(checkpoint);
  await forEachBatch(checkpoint.sources, async (source) => {
    const key = observationId(id, source);
    if (await actor.store.get("observation", key)) return;
    const version = captured?.get(sourceKey(source));
    await actor.store.insert(
      "observation",
      key,
      version ? { status: "captured", version } : await observe(actor, source),
      id,
    );
  });
  await actor.store.replace("checkpoint", id, existing.seq, {
    ...checkpoint,
    finishedAt: new Date().toISOString(),
  });
  return checkpointSummary(
    (await required<Checkpoint>(actor.store, "checkpoint", id)).data,
  );
}
command("workspace.capture", saveProjectCheckpoint);

command("workspace.exportCheckpoint", async (actor, payload) => {
  const checkpoint = (
    await required<Checkpoint>(
      actor.store,
      "checkpoint",
      recordId(payload.checkpointId),
    )
  ).data;
  const entries = [];
  let unavailable = 0;
  for (const source of checkpoint.sources) {
    const entry = await observation(actor, checkpoint, source);
    if (entry.status === "captured") entries.push(entry.version);
    else unavailable++;
  }
  return {
    format: "kinlet.project-checkpoint.v1",
    checkpoint: checkpointSummary(checkpoint),
    entries,
    unavailable,
  };
});

export async function observation(
  actor: Actor,
  checkpoint: Checkpoint,
  source: SourceRef,
): Promise<Observation> {
  if (!checkpoint.sources.some((item) => sourceKey(item) === sourceKey(source)))
    return { status: "unavailable" };
  if (!(await canReadSource(actor.client, actor.project, source)))
    return { status: "unavailable" };
  const stored = (
    await actor.store.get<Observation>(
      "observation",
      observationId(checkpoint.id, source),
    )
  )?.data;
  if (stored?.status !== "captured") return stored ?? { status: "pending" };
  // A historical relationship can reveal a ticket whose permissions later changed.
  const { related: _related, ...version } = stored.version;
  return { status: "captured", version };
}

command("workspace.compare", async (actor, payload) => {
  const source = requireSource(payload.source);
  const base = (
    await required<Checkpoint>(
      actor.store,
      "checkpoint",
      recordId(payload.baseId),
    )
  ).data;
  const current = payload.currentId
    ? (
        await required<Checkpoint>(
          actor.store,
          "checkpoint",
          recordId(payload.currentId),
        )
      ).data
    : null;
  if (!base.sources.some((item) => sourceKey(item) === sourceKey(source)))
    throw new Error("This source is outside the selected checkpoint.");
  const [saved, target] = await Promise.all([
    observation(actor, base, source),
    current ? observation(actor, current, source) : observe(actor, source),
  ]);
  return { saved, current: target };
});

export async function createWorkspaceBranch(
  actor: Actor,
  payload: Record<string, unknown>,
  metadata: Pick<
    Branch,
    | "predecessorId"
    | "reversalOf"
    | "requiredEdits"
    | "repair"
    | "origin"
    | "reviewTemplate"
  > = {},
) {
  const id = recordId(payload.requestId);
  const checkpointId = recordId(payload.checkpointId);
  const name = requireName(payload.name);
  const base = (
    await required<Checkpoint>(actor.store, "checkpoint", checkpointId)
  ).data;
  if (!base.finishedAt)
    throw new Error(
      "Finish capturing the checkpoint before creating a branch.",
    );
  const branch: Branch = {
    id,
    checkpointId,
    name,
    createdAt: new Date().toISOString(),
    revision: 0,
    ...metadata,
  };
  await actor.store.insert("branch", id, branch);
  const { data } = await required<Branch>(actor.store, "branch", id);
  if (data.name !== name || data.checkpointId !== checkpointId)
    throw new Error("This branch request is already in use.");
  return data;
}
command("workspace.createBranch", createWorkspaceBranch);

export async function branchState(actor: Actor, id: string) {
  const branch = (await required<Branch>(actor.store, "branch", id)).data;
  const base = (
    await required<Checkpoint>(actor.store, "checkpoint", branch.checkpointId)
  ).data;
  const [head] = await actor.store.revisions<StoredRevision>("revision", id);
  return { branch, base, head: head?.data };
}

command("workspace.branch", async (actor, payload) => {
  const { branch, base, head } = await branchState(
    actor,
    recordId(payload.branchId),
  );
  const accessible = new Set<string>();
  const read = sourceAccess(actor);
  if (head) {
    await forEachBatch(head.changes, async (change) => {
      if (await canSeeDraft(change, read))
        accessible.add(sourceKey(change.source));
    });
  }
  return {
    branch: { ...branch, revision: head?.revision ?? 0 },
    base: checkpointSummary(base),
    changes:
      head?.changes.filter(({ source }) => accessible.has(sourceKey(source))) ??
      [],
    revisions: (await actor.store.revisionList("revision", branch.id)).map(
      (row) => ({ revision: row.seq, createdAt: row.ordered_at }),
    ),
  };
});

command("workspace.revision", async (actor, payload) => {
  const id = recordId(payload.branchId);
  const revision = payload.revision;
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  )
    throw new Error("Choose an available branch revision.");
  const record = (
    await required<StoredRevision>(actor.store, "revision", id + ":" + revision)
  ).data;
  const changes: DraftChange[] = [];
  const read = sourceAccess(actor);
  await forEachBatch(record.changes, async (change) => {
    if (await canSeeDraft(change, read)) changes.push(change);
  });
  return { revision, changes };
});

function changeFrom(raw: unknown): DraftChange {
  if (!raw || typeof raw !== "object")
    throw new Error("Choose a source and enter draft wording.");
  const {
    source: value,
    title,
    body,
    priorityId,
  } = raw as Partial<DraftChange>;
  const source = requireSource(value);
  if (
    (title !== undefined &&
      (typeof title !== "string" || !title.trim() || title.length > 255)) ||
    (body !== undefined && typeof body !== "string") ||
    (priorityId !== undefined &&
      (source.kind !== "jira" || !validNativeId(priorityId)))
  )
    throw new Error("Enter valid draft wording or a Jira priority ID.");
  const change = {
    source,
    ...(title !== undefined && { title: title.trim() }),
    ...(body !== undefined && { body }),
    ...(priorityId !== undefined && { priorityId }),
  };
  if (!fitsWorkspace(change, workspaceLimits.draftBytes))
    throw new Error("This draft is too large to save.");
  return change;
}

export function validateRepairChange(branch: Branch, change: DraftChange) {
  const scope = branch.repair;
  if (!scope) return;
  const edited = reviewFields.filter(
    (field) =>
      change[field === "priority" ? "priorityId" : field] !== undefined,
  );
  if (
    sourceKey(change.source) !== sourceKey(scope.source) ||
    edited.length !== 1 ||
    edited[0] !== scope.field
  )
    throw new Error("This repair can edit only its assigned record and field.");
}

export async function saveWorkspaceDraft(
  actor: Actor,
  payload: Record<string, unknown>,
) {
  const id = recordId(payload.branchId);
  const requestId = recordId(payload.requestId);
  const { branch, base, head } = await branchState(actor, id);
  const revision = head?.revision ?? 0;
  const change = changeFrom(payload.change);
  validateRepairChange(branch, change);
  if ((await observation(actor, base, change.source)).status !== "captured")
    throw new Error("This source is unavailable in the branch checkpoint.");
  const previousChange = head?.changes.find(
    (item) => sourceKey(item.source) === sourceKey(change.source),
  );
  if (
    previousChange &&
    !(await canSeeDraft(previousChange, sourceAccess(actor)))
  )
    throw new Error("The existing draft depends on an unavailable source.");
  await validateDraftEvidence(
    change,
    payload.change as Partial<DraftChange>,
    base,
    (checkpoint, source) => observation(actor, checkpoint, source),
  );
  if (head?.requestId === requestId && head.author === actor.id)
    return { revision };
  if (payload.expectedRevision !== revision)
    throw new Error(
      "A newer draft revision exists. Refresh the branch and review your wording before saving.",
    );
  const changes = (head?.changes ?? []).filter(
    ({ source }) => sourceKey(source) !== sourceKey(change.source),
  );
  if (
    change.title !== undefined ||
    change.body !== undefined ||
    change.priorityId !== undefined
  )
    changes.push(change);
  if (!fitsWorkspace(changes, workspaceLimits.draftBytes))
    throw new Error("This branch draft is too large to save.");
  const next: StoredRevision = {
    revision: revision + 1,
    author: actor.id,
    createdAt: new Date().toISOString(),
    requestId,
    changes,
  };
  const key = branch.id + ":" + next.revision;
  const written = await actor.store.insert(
    "revision",
    key,
    next,
    branch.id,
    next.revision,
  );
  if (!written) {
    const existing = await required<StoredRevision>(
      actor.store,
      "revision",
      key,
    );
    if (
      existing.data.requestId !== requestId ||
      existing.data.author !== actor.id
    )
      throw new Error(
        "A newer draft revision exists. Refresh the branch before saving.",
      );
  }
  return { revision: next.revision };
}
command("workspace.saveDraft", saveWorkspaceDraft);

export { migrateWorkspace };

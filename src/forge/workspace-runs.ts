import {
  contextFormat,
  sessionFormat,
  sessionEventTypes,
  validNativeId,
  requireSource,
  sourceKey,
  type BranchRevision,
  type Checkpoint,
  type SessionEvent,
  type SessionExport,
  type SourceVersion,
  type WorkspaceQuestion,
  type WorkspaceRun,
  type WorkspaceProposal,
} from "../domain/workspace";
import { plainText } from "../platform/atlassian-text";
import {
  authorizeProject,
  branchState,
  command,
  forEachBatch,
  observation,
  recordId,
  required,
  saveWorkspaceDraft,
  type Actor,
} from "./workspace-resolver";
import {
  searchProjectApprovals,
  submitWorkspaceProposal,
} from "./workspace-publication";
import { fitsWorkspace } from "./workspace-sources";
import { readDecisionFollowUps } from "./workspace-decision-impact";
import { canSeeDraft, sourceAccess } from "./workspace-evidence";
import { branchBitbucket, readOrigin } from "./workspace-follow-up";
import { getTemplate } from "./workspace-templates";

function boundedText(value: unknown, max: number, allowEmpty = false) {
  if (
    typeof value !== "string" ||
    (!allowEmpty && !value.trim()) ||
    value.length > max
  )
    throw new Error("Enter text within the displayed length limit.");
  return value.trim();
}

async function openRun(actor: Actor, payload: Record<string, unknown>) {
  const id = recordId(payload.requestId);
  const branchId = recordId(payload.branchId);
  const objective = boundedText(payload.objective, 1000);
  const instructions = boundedText(payload.instructions ?? "", 4000, true);
  const { base, branch, head } = await branchState(actor, branchId);
  const existing = await actor.store.get<WorkspaceRun>("run", id);
  if (existing) {
    if (
      existing.data.author !== actor.id ||
      existing.data.branchId !== branchId ||
      existing.data.objective !== objective ||
      existing.data.instructions !== instructions ||
      (existing.data.template?.id ?? "") !==
        (branch.reviewTemplate?.id ?? payload.templateId ?? "") ||
      existing.data.revision !== payload.expectedRevision
    )
      throw new Error("This run request is already in use.");
    return { id };
  }
  const [template, bitbucket] = await Promise.all([
    branch.reviewTemplate ?? getTemplate(actor, payload.templateId),
    branchBitbucket(actor, branchId),
  ]);
  const revision = head?.revision ?? 0;
  if (payload.expectedRevision !== revision)
    throw new Error("Refresh the branch before preparing a context pack.");
  const sources = [];
  for (const source of base.sources)
    if ((await observation(actor, base, source)).status === "captured")
      sources.push(source);
  if (!sources.length)
    throw new Error("Capture at least one accessible source for this run.");
  await actor.store.insert("run", id, {
    id,
    branchId,
    checkpointId: base.id,
    revision,
    author: actor.id,
    objective,
    instructions,
    sources,
    ...(template && { template }),
    ...(bitbucket && { bitbucket }),
    createdAt: new Date().toISOString(),
  } satisfies WorkspaceRun);
  return { id };
}
command("workspace.openRun", openRun);

async function loadRun(actor: Actor, id: unknown) {
  return (await required<WorkspaceRun>(actor.store, "run", recordId(id))).data;
}

async function ownedRun(actor: Actor, id: unknown) {
  const run = await loadRun(actor, id);
  if (run.author !== actor.id)
    throw new Error("Open a run owned by your Atlassian account.");
  return run;
}

async function readContext(actor: Actor, payload: Record<string, unknown>) {
  const run = await ownedRun(actor, payload.runId);
  const base = (
    await required<Checkpoint>(actor.store, "checkpoint", run.checkpointId)
  ).data;
  if (!payload.source) {
    const visible: SourceVersion[] = [];
    await forEachBatch(run.sources ?? base.sources, async (source) => {
      const old = await observation(actor, base, source);
      if (old.status === "captured") visible.push(old.version);
    });
    const sources = visible.map(({ source, title, version }) => ({
      source,
      title: title.slice(0, 255),
      version,
    }));
    sources.sort((a, b) =>
      sourceKey(a.source).localeCompare(sourceKey(b.source)),
    );
    const decision = await readDecisionFollowUps(
      actor,
      run.branchId,
      base,
      visible,
    );
    const { branch } = await branchState(actor, run.branchId);
    const reusedDecision = await readOrigin(actor, branch.origin);
    const scope = branch.repair;
    const parent =
      scope &&
      (await actor.store.get<WorkspaceProposal>("proposal", scope.proposalId));
    const previous =
      scope &&
      parent?.data.changes.find(
        (change) => sourceKey(change.source) === sourceKey(scope.source),
      );
    const repair =
      scope &&
      previous &&
      sources.some(
        ({ source }) => sourceKey(source) === sourceKey(scope.source),
      ) &&
      (await canSeeDraft(previous, sourceAccess(actor)))
        ? {
            ...scope,
            previousDraft:
              previous[scope.field === "priority" ? "priorityId" : scope.field],
          }
        : undefined;
    return {
      format: contextFormat,
      projectId: actor.project,
      run,
      sources,
      unavailable: base.sources.length - sources.length,
      ...(decision && { decision }),
      ...(reusedDecision && { reusedDecision }),
      ...(repair && { repair }),
    };
  }
  const source = requireSource(payload.source);
  if (
    !(run.sources ?? base.sources).some(
      (item) => sourceKey(item) === sourceKey(source),
    )
  )
    return { status: "unavailable" };
  const saved = await observation(actor, base, source);
  if (saved.status !== "captured") return { status: "unavailable" };
  const revision =
    run.revision > 0
      ? (
          await required<BranchRevision>(
            actor.store,
            "revision",
            run.branchId + ":" + run.revision,
          )
        ).data
      : undefined;
  const candidate = revision?.changes.find(
    (change) => sourceKey(change.source) === sourceKey(source),
  );
  const draft =
    payload.sourceView !== "checkpoint" &&
    candidate &&
    (await canSeeDraft(candidate, sourceAccess(actor)))
      ? candidate
      : undefined;
  const body = draft?.body ?? plainText(saved.version.body);

  const from =
    typeof payload.offset === "number" &&
    Number.isSafeInteger(payload.offset) &&
    payload.offset >= 0
      ? payload.offset
      : 0;
  const end = Math.min(body.length, from + 3500);
  return {
    status: "captured",
    title: draft?.title ?? saved.version.title,
    version: saved.version.version,
    draft: !!draft,
    ...(draft?.citations && { citations: draft.citations }),
    body: body.slice(from, end),
    nextOffset: end < body.length ? end : null,
  };
}
command("workspace.context", readContext);

async function canViewRun(actor: Actor, run: WorkspaceRun) {
  const base = (
    await required<Checkpoint>(actor.store, "checkpoint", run.checkpointId)
  ).data;
  let allowed = true;
  await forEachBatch(run.sources ?? base.sources, async (source) => {
    if ((await observation(actor, base, source)).status !== "captured")
      allowed = false;
  });
  return allowed;
}

type SavedSession = SessionExport & { importedAt?: string };
type SessionPolicy = { days: number | null };
async function retention(actor: Actor) {
  return (
    (await actor.store.get<SessionPolicy>("settings", "session-retention"))
      ?.data ?? { days: null }
  );
}
function expired(session: SavedSession, days: number | null) {
  return (
    days !== null &&
    session.importedAt !== undefined &&
    Date.parse(session.importedAt) < Date.now() - days * 86_400_000
  );
}

command("workspace.retention", async (actor) => retention(actor));

command("workspace.saveRetention", async (actor, payload) => {
  if (!actor.canManage)
    throw new Error("A Jira project administrator manages retention.");
  const days = payload.days;
  if (days !== null && days !== 30 && days !== 90 && days !== 365)
    throw new Error("Choose a valid session retention period.");
  const before = await actor.store.get<SessionPolicy>(
    "settings",
    "session-retention",
  );
  const value = { days };
  const saved = before
    ? await actor.store.replace(
        "settings",
        "session-retention",
        before.seq,
        value,
      )
    : await actor.store.insert("settings", "session-retention", value);
  if (!saved) throw new Error("Retention changed. Refresh before saving.");
  return value;
});

command("workspace.removeSession", async (actor, payload) => {
  const run = await loadRun(actor, payload.runId);
  if (!actor.canManage && run.author !== actor.id)
    throw new Error(
      "Only the run owner or a project administrator can remove this session.",
    );
  const row = await actor.store.get<SavedSession>("session", run.id);
  if (row) await actor.store.remove("session", run.id, row.data);
  return { removed: true };
});

command("workspace.removeExpiredSessions", async (actor) => {
  if (!actor.canManage)
    throw new Error("A Jira project administrator manages retention.");
  const { days } = await retention(actor);
  if (days === null) return { count: 0 };
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await actor.store.recent<SavedSession>("session", cutoff, 6);
  let count = 0;
  for (const row of rows) {
    if (expired(row.data, days)) {
      await actor.store.remove("session", row.id, row.data);
      count++;
    }
  }
  return { count };
});

command("workspace.run", async (actor, payload) => {
  const run = await loadRun(actor, payload.runId);
  const own = run.author === actor.id;
  const visible = await canViewRun(actor, run);
  if (!visible)
    return {
      run: { id: run.id, branchId: run.branchId, createdAt: run.createdAt },
      own,
      visible,
    };
  const savedSession = (await actor.store.get<SavedSession>("session", run.id))
    ?.data;
  const session =
    savedSession && !expired(savedSession, (await retention(actor)).days)
      ? savedSession
      : undefined;
  const questions = (
    await actor.store.revisions<WorkspaceQuestion>("question", run.id, 25)
  ).map((row) => row.data);
  return {
    run,
    session,
    own,
    visible,
    questions,
    canRemove: own || actor.canManage,
  };
});

command("workspace.importSession", async (actor, payload) => {
  const run = await ownedRun(actor, payload.runId);
  if (!(await canViewRun(actor, run)))
    throw new Error(
      "You need access to the run’s captured sources to share this session.",
    );
  const value = payload.session as Partial<SessionExport> | undefined;
  if (
    !value ||
    value.format !== sessionFormat ||
    value.runId !== run.id ||
    typeof value.threadId !== "string" ||
    value.threadId.length > 100 ||
    !value.threadId ||
    !Array.isArray(value.events) ||
    value.events.length > 200 ||
    !fitsWorkspace(value, 96 * 1024)
  )
    throw new Error(
      "Choose a Kinlet session export for this run, up to 96 KB and 200 events.",
    );
  const events = value.events.map((event: SessionEvent) => {
    if (
      !event ||
      !sessionEventTypes.includes(event.kind) ||
      typeof event.at !== "string" ||
      !Number.isFinite(Date.parse(event.at)) ||
      (event.text !== undefined &&
        (typeof event.text !== "string" || event.text.length > 4000))
    )
      throw new Error("The session export contains an unsupported event.");
    return {
      kind: event.kind,
      at: new Date(event.at).toISOString(),
      ...(event.text && { text: event.text }),
    };
  });
  const session = {
    format: sessionFormat,
    runId: run.id,
    threadId: value.threadId,
    importedAt: new Date().toISOString(),
    events,
  };
  const current = await actor.store.get<SessionExport>("session", run.id);
  if (current && current.data.threadId !== value.threadId)
    throw new Error("This run already has a different Codex session.");
  const saved = current
    ? await actor.store.replace("session", run.id, current.seq, session)
    : await actor.store.insert("session", run.id, session);
  if (!saved)
    throw new Error(
      "The saved session changed. Reopen this run before importing again.",
    );
  return { count: events.length };
});

command("workspace.ask", async (actor, payload) => {
  const run = await ownedRun(actor, payload.runId);
  if (!(await canViewRun(actor, run)))
    throw new Error("The run’s sources are unavailable.");
  const id = recordId(payload.requestId);
  const question = boundedText(payload.question, 600);
  await actor.store.insert(
    "question",
    id,
    {
      id,
      runId: run.id,
      createdAt: new Date().toISOString(),
      question,
    } satisfies WorkspaceQuestion,
    run.id,
  );
  return { id };
});
command("workspace.answer", async (actor, payload) => {
  const id = recordId(payload.questionId);
  const row = await required<WorkspaceQuestion>(actor.store, "question", id);
  const run = await loadRun(actor, row.data.runId);
  if (!(await canViewRun(actor, run)))
    throw new Error("The run’s sources are unavailable.");
  if (
    row.data.answer ||
    !(await actor.store.replace("question", id, row.seq, {
      ...row.data,
      answer: boundedText(payload.answer, 600),
    }))
  )
    throw new Error("Someone already answered this question. Refresh the run.");
  return { id };
});

export async function openQuestions(actor: Actor) {
  const result: WorkspaceQuestion[] = [];
  for (const { data } of await actor.store.recent<WorkspaceQuestion>(
    "question",
  )) {
    if (
      !data.answer &&
      (await canViewRun(actor, await loadRun(actor, data.runId)))
    )
      result.push(data);
  }
  return result;
}

type ToolContext = { principal?: { accountId: string } };

async function fromTool(
  payload: Record<string, unknown>,
  context: ToolContext | undefined,
  work: (actor: Actor) => Promise<unknown>,
) {
  try {
    const id = context?.principal?.accountId;
    if (!validNativeId(payload.projectId) || typeof id !== "string" || !id)
      throw new Error(
        "Use the project ID from Kinlet and sign in with your Atlassian account.",
      );
    const actor = await authorizeProject(payload.projectId, id);
    return JSON.stringify(await work(actor));
  } catch (error) {
    return JSON.stringify({
      error:
        error instanceof Error
          ? error.message
          : "Unable to access the project workspace.",
    });
  }
}

export function toolOpenRun(
  payload: Record<string, unknown> = {},
  context?: ToolContext,
) {
  return fromTool(payload, context, (actor) =>
    openRun(actor, {
      ...payload,
      expectedRevision: Number(payload.expectedRevision),
    }),
  );
}

export function toolReadContext(
  payload: Record<string, unknown> = {},
  context?: ToolContext,
) {
  return fromTool(payload, context, (actor) =>
    readContext(actor, {
      ...payload,
      offset: Number(payload.offset),
      source: payload.sourceKind && {
        kind: payload.sourceKind,
        id: payload.sourceId,
      },
    }),
  );
}

export function toolSaveDraft(
  payload: Record<string, unknown> = {},
  context?: ToolContext,
) {
  return fromTool(payload, context, async (actor) => {
    const run = await ownedRun(actor, payload.runId);
    if (
      typeof payload.changeJson !== "string" ||
      payload.changeJson.length > 128 * 1024
    )
      throw new Error(
        "Supply a JSON draft change within the workspace size limit.",
      );
    const change = JSON.parse(payload.changeJson);
    return saveWorkspaceDraft(actor, {
      ...payload,
      branchId: run.branchId,
      expectedRevision: Number(payload.expectedRevision),
      change,
    });
  });
}

export function toolSubmitProposal(
  payload: Record<string, unknown> = {},
  context?: ToolContext,
) {
  return fromTool(payload, context, async (actor) => {
    const run = await ownedRun(actor, payload.runId);
    return submitWorkspaceProposal(
      actor,
      {
        ...payload,
        branchId: run.branchId,
        expectedRevision: Number(payload.expectedRevision),
      },
      run.id,
    );
  });
}

export function toolSearchApprovals(
  payload: Record<string, unknown> = {},
  context?: ToolContext,
) {
  return fromTool(payload, context, (actor) =>
    searchProjectApprovals(actor, payload),
  );
}

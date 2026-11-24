import { createHash } from "node:crypto";
import { route } from "@forge/api";
import {
  requireName,
  sourceKey,
  validNativeId,
  workspaceLimits,
  type BitbucketEvidence,
  type Branch,
  type BranchRevision,
  type DecisionOrigin,
  type DraftChange,
  type SourceVersion,
  type WorkspaceProposal,
  type WorkspacePublication,
} from "../domain/workspace";
import {
  authorizeProject,
  branchState,
  command,
  createWorkspaceBranch,
  recordId,
  required,
  saveCapturedCheckpoint,
  type Actor,
} from "./workspace-resolver";
import {
  canSeeDraft,
  currentSources,
  sourceAccess,
} from "./workspace-evidence";
import {
  captureSource,
  fitsWorkspace,
  jiraSourceVersion,
  resolveIssue,
} from "./workspace-sources";
import {
  prepareReversal,
  reviewChoices,
  searchProjectApprovals,
} from "./workspace-publication";

export function operationId(
  actor: Pick<Actor, "id">,
  requestId: string,
  kind: string,
  details: unknown,
) {
  const hash = createHash("sha256")
    .update(JSON.stringify([actor.id, requestId, kind, details]))
    .digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

export async function startFollowUp(
  actor: Actor,
  id: string,
  name: string,
  sources: SourceVersion[],
  changes: DraftChange[],
  metadata: Pick<
    Branch,
    | "predecessorId"
    | "reversalOf"
    | "requiredEdits"
    | "repair"
    | "origin"
    | "reviewTemplate"
  >,
) {
  if (
    !fitsWorkspace(changes, workspaceLimits.draftBytes) ||
    sources.some((source) => !fitsWorkspace(source))
  )
    throw new Error("The draft or one of its sources is too large.");
  await saveCapturedCheckpoint(actor, id, name, sources);
  if (changes.length)
    await actor.store.insert(
      "revision",
      id + ":1",
      {
        revision: 1,
        requestId: id,
        author: actor.id,
        createdAt: new Date().toISOString(),
        changes,
      } satisfies BranchRevision & { requestId: string },
      id,
    );
  return createWorkspaceBranch(
    actor,
    { requestId: id, checkpointId: id, name },
    metadata,
  );
}

command("workspace.followUp", async (actor, payload) => {
  const proposalId = recordId(payload.proposalId);
  const requestId = recordId(payload.requestId);
  const proposal = (
    await required<WorkspaceProposal>(actor.store, "proposal", proposalId)
  ).data;
  const name = requireName(payload.name);
  const picked = payload.fields;
  if (
    !Array.isArray(picked) ||
    !picked.length ||
    picked.length > 15 ||
    picked.some((field) => typeof field !== "string")
  )
    throw new Error("Select the fields to carry forward.");
  const id = operationId(actor, requestId, "follow-up", [
    proposalId,
    name,
    picked,
  ]);
  const existing = await actor.store.get<Branch>("branch", id);
  if (existing) return existing.data;
  const read = currentSources(actor);
  const available = (await reviewChoices(actor, proposal, read)).choices;
  const selected = available.filter((item) => picked.includes(item.id));
  if (
    selected.length !== new Set(picked).size ||
    selected.some(
      ({ hold, citations, conflict }) =>
        hold === "evidence_unavailable" ||
        (!hold && !conflict && (citations?.length ?? 0) < 2),
    )
  )
    throw new Error(
      "Choose fields that need review and whose evidence you can read.",
    );
  const sources = new Map<string, SourceVersion>();
  const changes = new Map<string, DraftChange>();
  for (const choice of selected) {
    const key = sourceKey(choice.source);
    const change = changes.get(key) ?? { source: choice.source };
    change[choice.field === "priority" ? "priorityId" : choice.field] =
      choice.proposed;
    changes.set(key, change);
    for (const ref of [
      choice.source,
      ...(choice.citations ?? []).flatMap(({ source }) =>
        source ? [source] : [],
      ),
    ]) {
      const source = await read(ref);
      if (!source) throw new Error("A cited source is unavailable.");
      sources.set(sourceKey(ref), source);
    }
  }
  return startFollowUp(
    actor,
    id,
    name,
    [...sources.values()],
    [...changes.values()],
    {
      predecessorId: proposalId,
      requiredEdits: selected
        .filter(({ citations }) => citations?.some(({ required }) => required))
        .map(({ id }) => id),
      reviewTemplate: proposal.template,
    },
  );
});

export async function beginRepair(
  actor: Actor,
  proposalId: string,
  fieldId: string,
) {
  const id = operationId({ id: actor.project }, proposalId, "repair", fieldId);
  const proposal = (
    await required<WorkspaceProposal>(actor.store, "proposal", proposalId)
  ).data;
  const change = proposal.changes.find((item) =>
    fieldId.startsWith(sourceKey(item.source) + ":"),
  );
  if (!change || !(await canSeeDraft(change, sourceAccess(actor))))
    throw new Error(
      "Restore access to the draft and its cited sources before preparing a repair.",
    );
  const existing = await actor.store.get<Branch>("branch", id);
  if (existing) return existing.data;
  const read = currentSources(actor);
  const choice = (await reviewChoices(actor, proposal, read)).choices.find(
    (item) => item.id === fieldId,
  );
  if (choice?.hold !== "evidence_changed")
    throw new Error(
      "Refresh the review and choose a field held by changed evidence.",
    );
  const refs = [
    choice.source,
    ...(choice.citations ?? []).flatMap(({ source }) =>
      source ? [source] : [],
    ),
  ];
  const sources = [];
  for (const ref of new Map(
    refs.map((source) => [sourceKey(source), source]),
  ).values()) {
    const source = await read(ref);
    if (!source)
      throw new Error(
        "Restore access to the cited source before preparing a repair.",
      );
    sources.push(source);
  }
  return startFollowUp(
    actor,
    id,
    "Revise held " + choice.field,
    sources,
    [
      {
        source: choice.source,
        [choice.field === "priority" ? "priorityId" : choice.field]:
          choice.proposed,
      },
    ],
    {
      predecessorId: proposalId,
      requiredEdits: [choice.id],
      repair: { proposalId, source: choice.source, field: choice.field },
      reviewTemplate: proposal.template,
    },
  );
}

command("workspace.repair", (actor, payload) =>
  beginRepair(
    actor,
    recordId(payload.proposalId),
    String(payload.fieldId ?? ""),
  ),
);

command("workspace.reversePublication", async (actor, payload) => {
  const publicationId = recordId(payload.publicationId);
  const name = requireName(payload.name);
  const id = operationId(actor, recordId(payload.requestId), "reversal", [
    publicationId,
    name,
  ]);
  const prior = await actor.store.get<Branch>("branch", id);
  if (prior) return prior.data;
  const { changes, sources, template } = await prepareReversal(
    actor,
    publicationId,
  );
  return startFollowUp(actor, id, name, sources, changes, {
    reversalOf: publicationId,
    reviewTemplate: template,
  });
});

async function projectFromKey(actor: Actor, key: unknown) {
  if (typeof key !== "string" || !/^[A-Z][A-Z0-9_]{0,29}$/.test(key))
    throw new Error("Enter a Jira project key.");
  const response = await actor.client.requestJira(
    route`/rest/api/3/project/${key}`,
  );
  if (!response.ok) throw new Error("The source project is unavailable.");
  const found = await response.json();
  const id = String(found.id);
  if (!validNativeId(id)) throw new Error("The source project is unavailable.");
  return authorizeProject(id, actor.id);
}

command("workspace.searchOtherDecisions", async (actor, payload) => {
  const origin = await projectFromKey(actor, payload.sourceProject);
  const result = await searchProjectApprovals(origin, payload);
  return {
    hits: result.hits.map((entry) => ({ ...entry, project: origin.project })),
  };
});

export async function readOrigin(
  actor: Actor,
  origin: DecisionOrigin | undefined,
) {
  if (!origin) return undefined;
  try {
    const sourceActor = await authorizeProject(origin.project, actor.id);
    const receipt = (
      await required<WorkspacePublication>(
        sourceActor.store,
        "publication",
        origin.publicationId,
      )
    ).data;
    const proposal = (
      await required<WorkspaceProposal>(
        sourceActor.store,
        "proposal",
        receipt.proposalId,
      )
    ).data;
    const read = sourceAccess(sourceActor);
    if (
      receipt.steps.some(
        ({ status }) => status !== "applied" && status !== "already_present",
      ) ||
      !(
        await Promise.all(
          proposal.changes.map((change) => canSeeDraft(change, read)),
        )
      ).every(Boolean)
    )
      return undefined;
    return {
      publicationId: receipt.id,
      name: proposal.name,
      reason: receipt.reason,
      approvedAt: receipt.approvedAt,
      checks: receipt.steps.map((step) => ({
        source: step.source,
        fields: step.fields,
        status: step.status,
        wording: step.desired.body ?? step.desired.title,
      })),
    };
  } catch {
    return undefined;
  }
}

command("workspace.reuseDecision", async (actor, payload) => {
  if (
    !validNativeId(payload.project) ||
    typeof payload.ticket !== "string" ||
    !/^[A-Z][A-Z0-9_]{0,29}-[1-9]\d{0,11}$/.test(payload.ticket)
  )
    throw new Error("Choose a source decision and a ticket from this project.");
  const origin = {
    project: payload.project,
    publicationId: recordId(payload.publicationId),
  };
  if (!(await readOrigin(actor, origin)))
    throw new Error("The original decision is unavailable.");
  const issue = jiraSourceVersion(
    await resolveIssue(actor.client, actor.project, payload.ticket, true),
  );
  const name = requireName(payload.name);
  return startFollowUp(
    actor,
    operationId(actor, recordId(payload.requestId), "reuse", [
      origin,
      issue.source,
      name,
    ]),
    name,
    [issue],
    [],
    { origin },
  );
});

command("workspace.branchOrigin", async (actor, payload) => {
  const { branch } = await branchState(actor, recordId(payload.branchId));
  return (await readOrigin(actor, branch.origin)) ?? null;
});

command("workspace.crossProjectImpact", async (actor, payload) => {
  if (
    typeof payload.ticket !== "string" ||
    !/^[A-Z][A-Z0-9_]{0,29}-[1-9]\d{0,11}$/.test(payload.ticket)
  )
    throw new Error("Enter a Jira ticket key from this project.");
  const from = jiraSourceVersion(
    await resolveIssue(actor.client, actor.project, payload.ticket, true),
  );
  const scores = new Map(
    from.related
      ?.filter(({ id }) => validNativeId(id))
      .map((link) => [link.id, link.type]),
  );
  const found: Array<{
    key: string;
    title: string;
    relation: string;
    status?: string;
  }> = [];
  for (const [id, relation] of [...scores].slice(0, 10)) {
    try {
      const issue = await resolveIssue(actor.client, undefined, id, true);
      if (String(issue.fields.project.id) === actor.project) continue;
      const version = jiraSourceVersion(issue);
      found.push({
        key: version.key,
        title: version.title,
        relation,
        status: version.status,
      });
      if (found.length === 5) break;
    } catch {
      // Jira filters inaccessible issues. Do not return their identity.
    }
  }
  return found;
});

function parseBitbucket(value: unknown): BitbucketEvidence {
  if (!value || typeof value !== "object")
    throw new Error("Import a Bitbucket evidence file.");
  const entry = value as BitbucketEvidence;
  if (
    typeof entry.url !== "string" ||
    !/^https:\/\/bitbucket\.org\/[a-z\d_-]+\/[a-z\d_.-]+\/pull-requests\/[1-9]\d{0,11}$/i.test(
      entry.url,
    ) ||
    typeof entry.commit !== "string" ||
    !/^[a-f\d]{40}$/i.test(entry.commit) ||
    typeof entry.observedAt !== "string" ||
    !Number.isFinite(Date.parse(entry.observedAt)) ||
    Date.parse(entry.observedAt) > Date.now() + 300_000 ||
    !Array.isArray(entry.statuses) ||
    entry.statuses.length > 10
  )
    throw new Error(
      "Import a public Bitbucket pull request and its captured statuses.",
    );
  const statuses = entry.statuses.map((item) => {
    if (
      !item ||
      typeof item.key !== "string" ||
      !/^[\w. -]{1,80}$/.test(item.key) ||
      !["SUCCESSFUL", "FAILED", "INPROGRESS", "STOPPED"].includes(item.state)
    )
      throw new Error("A Bitbucket build status is invalid.");
    return { key: item.key, state: item.state };
  });
  return {
    url: entry.url,
    commit: entry.commit,
    observedAt: entry.observedAt,
    statuses,
  };
}

export async function branchBitbucket(actor: Actor, branchId: string) {
  return (
    await actor.store.get<BitbucketEvidence>("bitbucket-evidence", branchId)
  )?.data;
}

command("workspace.branchBitbucket", async (actor, payload) => {
  const id = recordId(payload.branchId);
  await branchState(actor, id);
  return (await branchBitbucket(actor, id)) ?? null;
});

command("workspace.importBitbucket", async (actor, payload) => {
  if (!actor.canManage || payload.publicConfirmed !== true)
    throw new Error(
      "A project administrator must confirm the pull request is public.",
    );
  const id = recordId(payload.branchId);
  await branchState(actor, id);
  const evidence = parseBitbucket(payload.evidence);
  const previous = await actor.store.get<BitbucketEvidence>(
    "bitbucket-evidence",
    id,
  );
  const saved = previous
    ? await actor.store.replace(
        "bitbucket-evidence",
        id,
        previous.seq,
        evidence,
      )
    : await actor.store.insert("bitbucket-evidence", id, evidence);
  if (!saved) throw new Error("Bitbucket evidence changed. Reopen the branch.");
  return evidence;
});

command("workspace.timeline", async (actor, payload) => {
  const proposalId = recordId(payload.proposalId);
  const proposal = (
    await required<WorkspaceProposal>(actor.store, "proposal", proposalId)
  ).data;
  const read = sourceAccess(actor);
  if (
    !(
      await Promise.all(
        proposal.changes.map((change) => canSeeDraft(change, read)),
      )
    ).every(Boolean)
  )
    return { unavailable: true, entries: [] };
  const { branch, base } = await branchState(actor, proposal.branchId);
  const [receipts, alternatives, choices] = await Promise.all([
    actor.store.recent<WorkspacePublication>("publication"),
    actor.store.recent<Branch>("branch"),
    reviewChoices(actor, proposal),
  ]);
  const entries: Array<{
    at: string;
    title: string;
    detail?: string;
    id?: string;
    kind?: "publication" | "proposal" | "session";
    source?: SourceVersion["source"];
  }> = [
    { at: base.finishedAt ?? base.startedAt, title: "Checkpoint saved" },
    { at: branch.createdAt, title: "Draft branch opened" },
    {
      at: proposal.createdAt,
      title: "Proposal submitted",
      detail: proposal.name,
    },
  ];
  for (const { data } of alternatives)
    if (data.checkpointId === base.id && data.id !== branch.id)
      entries.push({ at: data.createdAt, title: "Alternative branch created" });
  if (proposal.runId)
    entries.push({
      at: proposal.createdAt,
      title: "Agent run attached",
      id: proposal.runId,
      kind: "session",
    });
  if (proposal.predecessorId)
    entries.push({
      at: branch.createdAt,
      title: branch.repair
        ? "Original proposal with held edit"
        : "Earlier proposal",
      id: proposal.predecessorId,
      kind: "proposal",
    });
  if (proposal.reversalOf)
    entries.push({
      at: branch.createdAt,
      title: "Reversal of publication",
      id: proposal.reversalOf,
      kind: "publication",
    });
  for (const { data } of receipts) {
    if (data.proposalId !== proposalId) continue;
    entries.push({
      at: data.approvedAt,
      title: "Approval recorded",
      detail: data.reason,
      id: data.id,
      kind: "publication",
    });
    for (const step of data.steps) {
      if (step.status === "pending") continue;
      const live = await captureSource(
        actor.client,
        actor.project,
        step.source,
      ).catch(() => undefined);
      const title = {
        source_changed: "Edit held for review",
        applied: "Native change applied",
        already_present: "Approved wording verified",
        verification_required: "Publication needs verification",
      }[step.status];
      entries.push({
        at: step.checkedAt ?? data.approvedAt,
        title,
        detail: live?.title,
        id: data.id,
        kind: "publication",
        ...(live && { source: live.source }),
      });
    }
  }
  if (choices.choices.some(({ hold }) => hold))
    entries.push({
      at: new Date().toISOString(),
      title: "Evidence needs review",
    });
  return { entries: entries.sort((a, b) => a.at.localeCompare(b.at)) };
});

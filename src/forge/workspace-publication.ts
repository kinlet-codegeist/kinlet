import { createHash } from "node:crypto";
import { route } from "@forge/api";
import {
  requireName,
  reviewFields,
  sourceKey,
  type DraftChange,
  type Checkpoint,
  type PublicationStep,
  type ReviewChoice,
  type ReviewField,
  type SourceVersion,
  type WorkspaceProposal,
  type WorkspacePublication,
  type WorkspaceRun,
} from "../domain/workspace";
import { descriptionUpdate } from "../domain/description-update";
import { plainText, type AdfNode } from "../platform/atlassian-text";
import { textDocument } from "../domain/editable-passages";
import {
  branchState,
  command,
  observation,
  recordId,
  required,
  saveProjectCheckpoint,
  validateRepairChange,
  type Actor,
} from "./workspace-resolver";
import {
  canReadSource,
  canEditSource,
  captureSource,
} from "./workspace-sources";
import {
  canSeeDraft,
  checkCitations,
  citationsOf,
  currentSources,
  sourceAccess,
} from "./workspace-evidence";
import { getTemplate } from "./workspace-templates";

const selectedFields = reviewFields;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fieldValue = (version: SourceVersion, field: ReviewField) =>
  field === "body"
    ? plainText(version.body)
    : field === "priority"
      ? (version.priority?.id ?? "")
      : version.title;
const draftValue = (change: DraftChange, field: ReviewField) =>
  field === "priority" ? change.priorityId : change[field];
const fieldHash = (version: SourceVersion, fields: ReviewField[]) =>
  digest(fields.map((field) => fieldValue(version, field)));
const sourceHash = (version: SourceVersion, fields: ReviewField[]) =>
  digest(
    fields.map((field) =>
      field === "body" ? version.body : fieldValue(version, field),
    ),
  );
const complete = (step: PublicationStep) =>
  step.status === "applied" || step.status === "already_present";
const approvalLifetime = 15 * 60 * 1000;

export async function submitWorkspaceProposal(
  actor: Actor,
  payload: Record<string, unknown>,
  runId?: string,
) {
  const id = recordId(payload.requestId);
  const name = requireName(payload.name);
  const branchId = recordId(payload.branchId);
  const previous = await actor.store.get<WorkspaceProposal>("proposal", id);
  if (previous) {
    if (
      previous.data.branchId !== branchId ||
      previous.data.revision !== payload.expectedRevision ||
      previous.data.runId !== runId ||
      previous.data.name !== name
    )
      throw new Error("This proposal request is already in use.");
    return { id };
  }
  const { base, branch, head } = await branchState(actor, branchId);
  const template =
    branch.reviewTemplate ??
    (runId
      ? (await required<WorkspaceRun>(actor.store, "run", runId)).data.template
      : await getTemplate(actor, payload.templateId));
  if (!head?.changes.length || head.revision !== payload.expectedRevision)
    throw new Error(
      "Save and reopen the latest draft revision before submitting a proposal.",
    );
  if (head.changes.length > 5)
    throw new Error("Submit proposals of up to five source records.");
  if (branch.repair && (head.revision < 2 || head.changes.length !== 1))
    throw new Error("Save a revised field before submitting this repair.");
  const read = sourceAccess(actor);
  for (const change of head.changes) {
    validateRepairChange(branch, change);
    if (!(await canSeeDraft(change, read)))
      throw new Error("A proposed source is unavailable to this account.");
    for (const field of selectedFields) {
      if (
        draftValue(change, field) !== undefined &&
        (template?.evidenceFor.includes(field) ||
          branch.requiredEdits?.includes(
            sourceKey(change.source) + ":" + field,
          )) &&
        !change.citations?.[field]?.some(({ required }) => required)
      )
        throw new Error(
          "Attach current required evidence to each field covered by the review.",
        );
    }
  }
  await actor.store.insert("proposal", id, {
    id,
    name,
    branchId,
    checkpointId: base.id,
    revision: head.revision,
    createdAt: new Date().toISOString(),
    changes: head.changes,
    ...(template && { template }),
    ...(branch.predecessorId && { predecessorId: branch.predecessorId }),
    ...(branch.reversalOf && { reversalOf: branch.reversalOf }),
    ...(runId && { runId }),
  } satisfies WorkspaceProposal);
  return { id };
}
command("workspace.submitProposal", submitWorkspaceProposal);

export async function reviewChoices(
  actor: Actor,
  proposal: WorkspaceProposal,
  read = currentSources(actor),
) {
  const checkpoint = (
    await required<Parameters<typeof observation>[1]>(
      actor.store,
      "checkpoint",
      proposal.checkpointId,
    )
  ).data;
  const comparisons = await Promise.all(
    proposal.changes.map(async (change) => {
      const saved = await observation(actor, checkpoint, change.source);
      if (saved.status !== "captured") return null;
      const live = await read(change.source);
      if (!live) return null;
      const choices: ReviewChoice[] = [];
      for (const field of selectedFields) {
        const value = draftValue(change, field);
        const current = fieldValue(live, field);
        if (value === undefined || value === current) continue;
        const base = fieldValue(saved.version, field);
        const references = change.citations?.[field] ?? [];
        const citations = await checkCitations(references, read);
        const hidden = citations.some(({ status }) => status === "unavailable");
        const disputed =
          references.length > 1 &&
          (await actor.store.get(
            "field-dispute",
            proposal.id + ":" + sourceKey(change.source) + ":" + field,
          ));
        const hold = hidden
          ? "evidence_unavailable"
          : change.disputed?.includes(field) || disputed
            ? "disputed"
            : citations.some(
                  ({ required, status }) => required && status !== "current",
                )
              ? "evidence_changed"
              : undefined;
        choices.push({
          id: sourceKey(change.source) + ":" + field,
          source: change.source,
          label: live.title,
          field,
          base,
          current,
          proposed: hidden ? "" : value,
          conflict: current !== base,
          available:
            !hold &&
            (field !== "body" || !!descriptionUpdate(live.body, value)),
          evidence: approvalEvidence(proposal, live, field, value, references),
          ...(references.length > 0 && { citations }),
          ...(hold && { hold }),
        });
      }
      return choices;
    }),
  );
  const available = comparisons.filter((choices) => choices !== null);
  return {
    choices: available.flat(),
    unavailable: comparisons.length - available.length,
  };
}

function approvalEvidence(
  proposal: WorkspaceProposal,
  live: SourceVersion,
  field: ReviewField,
  value: string,
  citations: NonNullable<DraftChange["citations"]>[ReviewField],
) {
  return digest([
    proposal.id,
    field,
    value,
    field === "body" ? live.body : fieldValue(live, field),
    live.source.kind === "confluence" && !fieldApproval(proposal)
      ? live.version
      : null,
    citations ?? [],
  ]);
}

function fieldApproval(proposal: WorkspaceProposal) {
  return !!(
    proposal.template ||
    proposal.predecessorId ||
    proposal.reversalOf ||
    proposal.changes.some((change) => citationsOf(change).length)
  );
}
command("workspace.previewProposal", async (actor, payload) => {
  const proposal = (
    await required<WorkspaceProposal>(
      actor.store,
      "proposal",
      recordId(payload.proposalId),
    )
  ).data;
  const result = await reviewChoices(actor, proposal);
  return {
    name:
      result.unavailable ||
      result.choices.some(({ hold }) => hold === "evidence_unavailable")
        ? "Review proposal"
        : proposal.name,
    ...result,
  };
});

command("workspace.disputeEvidence", async (actor, payload) => {
  const id = recordId(payload.proposalId);
  const proposal = (
    await required<WorkspaceProposal>(actor.store, "proposal", id)
  ).data;
  const choice = (await reviewChoices(actor, proposal)).choices.find(
    (item) => item.id === payload.field,
  );
  if (
    !choice ||
    choice.hold === "evidence_unavailable" ||
    (choice.citations?.length ?? 0) < 2 ||
    (proposal.template?.approval === "admins" && !actor.canManage) ||
    !(await canEditSource(actor.client, choice.source))
  )
    throw new Error("Choose two readable citations on a field you can review.");
  await actor.store.insert("field-dispute", id + ":" + choice.id, {
    author: actor.id,
    at: new Date().toISOString(),
  });
  return { held: true };
});

command("workspace.approve", async (actor, payload) => {
  const id = recordId(payload.requestId);
  const proposalId = recordId(payload.proposalId);
  const reason =
    typeof payload.reason === "string" ? payload.reason.trim() : "";
  const picks = payload.selection as
    Array<{ id: string; evidence: string }> | undefined;
  if (
    !reason ||
    reason.length > 600 ||
    !Array.isArray(picks) ||
    !picks.length ||
    picks.length > 15 ||
    picks.some(
      (pick) =>
        typeof pick?.id !== "string" || typeof pick?.evidence !== "string",
    )
  )
    throw new Error(
      "Choose fields and enter a reason of up to 600 characters.",
    );
  const old = await actor.store.get<WorkspacePublication>("publication", id);
  const approvalKey = digest(picks.map(({ id, evidence }) => [id, evidence]));
  if (old) {
    if (
      old.data.approver !== actor.id ||
      old.data.proposalId !== proposalId ||
      old.data.reason !== reason ||
      (old.data.approvalKey !== undefined &&
        old.data.approvalKey !== approvalKey)
    )
      throw new Error("This publication request is already in use.");
    return { id };
  }
  const proposal = (
    await required<WorkspaceProposal>(actor.store, "proposal", proposalId)
  ).data;
  if (proposal.template?.approval === "admins" && !actor.canManage)
    throw new Error("A Jira project administrator must approve this proposal.");
  const { choices } = await reviewChoices(actor, proposal);
  const selected = new Map<string, ReviewChoice[]>();
  for (const pick of picks) {
    const choice = choices.find(
      (item) => item.id === pick?.id && item.evidence === pick.evidence,
    );
    if (!choice?.available)
      throw new Error(
        "The source changed or can no longer be edited. Refresh the review.",
      );
    const key = sourceKey(choice.source);
    const list = selected.get(key) ?? [];
    if (!list.some(({ id: fieldId }) => fieldId === choice.id))
      list.push(choice);
    selected.set(key, list);
  }
  if (selected.size > 5)
    throw new Error("Select changes on up to five Jira or Confluence records.");
  const steps: PublicationStep[] = [];
  const separate = fieldApproval(proposal);
  const read = currentSources(actor);
  for (const list of selected.values()) {
    const source = list[0].source;
    if (!(await canEditSource(actor.client, source)))
      throw new Error("You need permission to edit each selected record.");
    const live = await read(source);
    if (!live) throw new Error("The selected source is unavailable.");
    const change = proposal.changes.find(
      (item) => sourceKey(item.source) === sourceKey(source),
    )!;
    for (const group of separate ? list.map((choice) => [choice]) : [list]) {
      const fields = group.map(({ field }) => field);
      const desired: DraftChange = { source };
      for (const { field, proposed, evidence } of group) {
        const refs = change.citations?.[field] ?? [];
        if (
          evidence !==
            approvalEvidence(proposal, live, field, proposed, refs) ||
          (await checkCitations(refs, read)).some(
            ({ required, status }) =>
              status === "unavailable" || (required && status !== "current"),
          )
        )
          throw new Error("The source changed. Refresh the review.");
        if (field === "priority") desired.priorityId = proposed;
        else desired[field] = proposed;
      }
      const refs = separate ? change.citations?.[fields[0]] : undefined;
      steps.push({
        source,
        fields,
        desired,
        before: sourceHash(live, fields),
        after: digest(fields.map((field) => draftValue(desired, field))),
        version:
          !separate && source.kind === "confluence" ? live.version : undefined,
        ...(refs?.length && { citations: refs }),
        ...(separate && { previous: fieldValue(live, fields[0]) }),
        status: "pending",
      });
    }
  }
  const publication = {
    id,
    proposalId,
    reason,
    approver: actor.id,
    approvedAt: new Date().toISOString(),
    steps,
    approvalKey,
    ...(separate && { fieldApproval: true }),
  };
  await actor.store.insert("publication", id, publication);
  return { id };
});

async function writeSource(
  actor: Actor,
  live: SourceVersion,
  step: PublicationStep,
  publication: WorkspacePublication,
) {
  const { source, desired } = step;
  let body: AdfNode | null | undefined;
  if (desired.body !== undefined) {
    const edited = descriptionUpdate(live.body, desired.body);
    if (!edited)
      throw new Error("The selected wording would alter protected formatting.");
    body = edited.description;
  }
  if (source.kind === "jira") {
    const response = await actor.client.requestJira(
      route`/rest/api/3/issue/${source.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            ...(desired.title !== undefined && { summary: desired.title }),
            ...(body !== undefined && { description: body }),
            ...(desired.priorityId !== undefined && {
              priority: { id: desired.priorityId },
            }),
          },
          historyMetadata: {
            type: "kinlet:workspace-publication:v1",
            activityDescription: "Applied a reviewed Kinlet publication",
            extraData: {
              publicationId: publication.id,
              proposalId: publication.proposalId,
            },
          },
        }),
      },
    );
    if (!response.ok) throw new Error("Jira could not apply these fields.");
    return;
  }
  const response = await actor.client.requestConfluence(
    route`/wiki/api/v2/pages/${source.id}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: source.id,
        status: "current",
        title: desired.title ?? live.title,
        body: {
          representation: "atlas_doc_format",
          value: JSON.stringify(
            body === undefined ? live.body : (body ?? textDocument("")),
          ),
        },
        version: {
          number: Number(live.version) + 1,
          message: "Kinlet publication " + publication.id,
        },
      }),
    },
  );
  if (!response.ok) throw new Error("Confluence could not apply this version.");
}

command("workspace.publication", async (actor, payload) => {
  const { data } = await required<WorkspacePublication>(
    actor.store,
    "publication",
    recordId(payload.publicationId),
  );
  const read = sourceAccess(actor);
  const visible = await Promise.all(
    data.steps.map((step) =>
      canSeeDraft(
        { source: step.source, citations: { body: step.citations } },
        read,
      ),
    ),
  );
  const proposal = await actor.store.get<WorkspaceProposal>(
    "proposal",
    data.proposalId,
  );
  const reasonVisible =
    visible.every(Boolean) &&
    !!proposal &&
    (
      await Promise.all(
        proposal.data.changes.map((change) => canSeeDraft(change, read)),
      )
    ).every(Boolean);
  return {
    id: data.id,
    proposalId: data.proposalId,
    reason: reasonVisible ? data.reason : "Review reason unavailable.",
    approvedAt: data.approvedAt,
    canContinue:
      data.approver === actor.id &&
      (proposal?.data.template?.approval !== "admins" || actor.canManage),
    fieldApproval: !!data.fieldApproval,
    steps: await Promise.all(
      data.steps.map(async (step, index) => {
        if (!visible[index])
          return { index, label: "Source unavailable", status: step.status };
        try {
          const source = await captureSource(
            actor.client,
            actor.project,
            step.source,
          );
          return {
            index,
            label: source.title,
            status: step.status,
            ...(data.fieldApproval && { field: step.fields[0] }),
          };
        } catch {
          return { index, label: "Source unavailable", status: step.status };
        }
      }),
    ),
  };
});

type PublicationLock = {
  publicationId: string;
  attempt: string;
  checkedAt: number;
};

command("workspace.publishNext", async (actor, payload) => {
  const id = recordId(payload.publicationId);
  const row = await required<WorkspacePublication>(
    actor.store,
    "publication",
    id,
  );
  const { data } = row;
  if (data.approver !== actor.id)
    throw new Error("The reviewer who approved this change must continue it.");
  const step = data.steps.find(
    (item) =>
      !complete(item) &&
      (!data.fieldApproval || item.status !== "source_changed"),
  );
  if (!step) return { done: data.steps.every(complete) };
  if (step.status === "source_changed")
    throw new Error(
      "The source changed. Review the proposal again for the remaining edits.",
    );
  const key = sourceKey(step.source);
  const nextLock: PublicationLock = {
    publicationId: id,
    attempt: crypto.randomUUID(),
    checkedAt: Date.now(),
  };
  const existing = await actor.store.get<PublicationLock>("publish-lock", key);
  if (
    existing &&
    (existing.data.publicationId !== id ||
      Date.now() - existing.data.checkedAt < 75_000)
  )
    throw new Error(
      "There is a pending write on this source. Wait for the review that started it to verify the result.",
    );
  const acquired = existing
    ? await actor.store.replace("publish-lock", key, existing.seq, nextLock)
    : await actor.store.insert("publish-lock", key, nextLock);
  if (!acquired)
    throw new Error(
      "Someone is already publishing this source. Check the receipt and try again.",
    );

  const current = await required<WorkspacePublication>(
    actor.store,
    "publication",
    id,
  );
  if (current.seq !== row.seq) {
    await actor.store.remove("publish-lock", key, nextLock);
    throw new Error("The publication progressed. Refresh the receipt.");
  }
  let canRelease = step.status === "pending";
  async function mark(status: PublicationStep["status"], seq: number) {
    step!.status = status;
    step!.checkedAt = new Date().toISOString();
    if (!(await actor.store.replace("publication", id, seq, data)))
      throw new Error("The receipt changed. Check it before continuing.");
    return { done: data.steps.every(complete), status };
  }
  try {
    const live = await captureSource(actor.client, actor.project, step.source);
    const hash = fieldHash(live, step.fields);
    if (hash === step.after) {
      const result = await mark("already_present", row.seq);
      canRelease = true;
      return result;
    }
    if (
      sourceHash(live, step.fields) !== step.before ||
      (step.version && step.version !== live.version)
    ) {
      const result = await mark("source_changed", row.seq);
      canRelease = true;
      return result;
    }
    if (Date.now() - Date.parse(data.approvedAt) > approvalLifetime) {
      const result = await mark("source_changed", row.seq);
      canRelease = true;
      return result;
    }
    const proposal = (
      await required<WorkspaceProposal>(
        actor.store,
        "proposal",
        data.proposalId,
      )
    ).data;
    const citations = await checkCitations(
      step.citations ?? [],
      currentSources(actor),
    );
    const disputed =
      data.fieldApproval &&
      (await actor.store.get(
        "field-dispute",
        proposal.id + ":" + sourceKey(step.source) + ":" + step.fields[0],
      ));
    if (
      disputed ||
      (proposal.template?.approval === "admins" && !actor.canManage) ||
      !(await canEditSource(actor.client, step.source)) ||
      citations.some(
        ({ required, status }) =>
          status === "unavailable" || (required && status !== "current"),
      )
    ) {
      const result = await mark("source_changed", row.seq);
      canRelease = true;
      return result;
    }
    await mark("verification_required", row.seq);
    canRelease = false;
    try {
      await writeSource(actor, live, step, data);
    } catch {
      return { done: false, status: "verification_required" };
    }
    const confirmed = await captureSource(
      actor.client,
      actor.project,
      step.source,
    );
    if (fieldHash(confirmed, step.fields) !== step.after)
      return { done: false, status: "verification_required" };
    const result = await mark("applied", row.seq + 1);
    canRelease = true;
    return result;
  } finally {
    if (canRelease) await actor.store.remove("publish-lock", key, nextLock);
  }
});

export async function searchProjectApprovals(
  actor: Actor,
  payload: Record<string, unknown>,
) {
  const query =
    typeof payload.query === "string"
      ? payload.query.trim().slice(0, 200).toLowerCase()
      : "";
  if (!query) return { hits: [] };
  const hits = [];
  const read = sourceAccess(actor);
  for (const { data } of await actor.store.recent<WorkspacePublication>(
    "publication",
  )) {
    if (
      !data.steps.every(complete) ||
      !data.reason.toLowerCase().includes(query)
    )
      continue;
    if (
      !(
        await Promise.all(
          data.steps.map(({ source }) =>
            canReadSource(actor.client, actor.project, source),
          ),
        )
      ).every(Boolean)
    )
      continue;
    const proposal = await actor.store.get<WorkspaceProposal>(
      "proposal",
      data.proposalId,
    );
    if (
      proposal &&
      !(
        await Promise.all(
          proposal.data.changes.map((change) => canSeeDraft(change, read)),
        )
      ).every(Boolean)
    )
      continue;
    hits.push({
      publicationId: data.id,
      proposalId: data.proposalId,
      title: proposal?.data.name ?? "Published proposal",
      reason: data.reason,
      approvedAt: data.approvedAt,
      sources: data.steps.map(({ source }) => source),
      checkpointId: proposal?.data.checkpointId,
    });
    if (hits.length >= 10) break;
  }
  return { hits };
}
command("workspace.searchApprovals", searchProjectApprovals);

export async function openWorkspaceReviews(actor: Actor) {
  const [proposals, publications] = await Promise.all([
    actor.store.recent<WorkspaceProposal>("proposal"),
    actor.store.recent<WorkspacePublication>("publication"),
  ]);
  const predecessor = new Map(
    proposals.map(({ data }) => [data.id, data.predecessorId]),
  );
  const successorFields = new Map<string, Set<string>>();
  for (const { data } of publications) {
    let id = predecessor.get(data.proposalId);
    const visited = new Set<string>();
    while (id && !visited.has(id)) {
      visited.add(id);
      const fields = successorFields.get(id) ?? new Set<string>();
      for (const step of data.steps.filter(complete))
        for (const field of step.fields)
          fields.add(sourceKey(step.source) + ":" + field);
      successorFields.set(id, fields);
      id = predecessor.get(id);
    }
  }
  const visible = [];
  const read = sourceAccess(actor);
  const live = currentSources(actor);
  for (const { data } of proposals) {
    const access = await Promise.all(
      data.changes.map((change) => canSeeDraft(change, read)),
    );
    if (!access.some(Boolean)) continue;
    const active =
      access.every(Boolean) &&
      data.changes.some((change) => citationsOf(change).length);
    const held =
      active &&
      (await reviewChoices(actor, data, live)).choices.filter(
        (choice) =>
          choice.hold && !successorFields.get(data.id)?.has(choice.id),
      ).length;
    visible.push({
      id: data.id,
      name: access.every(Boolean) ? data.name : "Review proposal",
      createdAt: data.createdAt,
      ...(held && { held }),
    });
  }
  return {
    proposals: visible,
    publications: publications.map(({ data }, index) => {
      // A verified replacement resolves the stale task while preserving its receipt.
      const replacements = publications
        .slice(0, index)
        .filter((row) => row.data.proposalId === data.proposalId)
        .flatMap((row) => row.data.steps.filter(complete));
      return {
        id: data.id,
        proposalId: data.proposalId,
        approvedAt: data.approvedAt,
        steps: data.steps
          .filter(
            (step) =>
              (step.status !== "source_changed" && step.status !== "pending") ||
              (!replacements.some(
                (replacement) =>
                  sourceKey(replacement.source) === sourceKey(step.source) &&
                  replacement.fields.join(",") === step.fields.join(",") &&
                  replacement.after === step.after,
              ) &&
                !step.fields.every((field) =>
                  successorFields
                    .get(data.proposalId)
                    ?.has(sourceKey(step.source) + ":" + field),
                )),
          )
          .map((step) => step.status),
      };
    }),
  };
}

command("workspace.capturePublished", async (actor, payload) => {
  const id = recordId(payload.publicationId);
  const publication = (
    await required<WorkspacePublication>(actor.store, "publication", id)
  ).data;
  if (!publication.steps.every(complete))
    throw new Error("Verify all publication steps before saving the result.");
  const record = {
    requestId: id,
    name: "Publication result " + id.slice(0, 8),
  };
  const { data: proposal } = await required<WorkspaceProposal>(
    actor.store,
    "proposal",
    publication.proposalId,
  );
  if (!(await actor.store.get("decision_seed", proposal.branchId)))
    return saveProjectCheckpoint(actor, record);
  const { data: base } = await required<Checkpoint>(
    actor.store,
    "checkpoint",
    proposal.checkpointId,
  );
  return saveProjectCheckpoint(actor, record, base.sources);
});

export async function prepareReversal(actor: Actor, publicationId: string) {
  const receipt = (
    await required<WorkspacePublication>(
      actor.store,
      "publication",
      publicationId,
    )
  ).data;
  if (!receipt.steps.every(complete))
    throw new Error(
      "Finish verifying the publication before staging a reversal.",
    );
  const applied = receipt.steps.filter(({ status }) => status === "applied");
  if (!applied.length)
    throw new Error("This receipt has no confirmed Kinlet writes to reverse.");
  const proposal = (
    await required<WorkspaceProposal>(
      actor.store,
      "proposal",
      receipt.proposalId,
    )
  ).data;
  const read = sourceAccess(actor);
  if (
    !(
      await Promise.all(
        proposal.changes.map((change) => canSeeDraft(change, read)),
      )
    ).every(Boolean)
  )
    throw new Error("Some evidence for this publication is unavailable.");
  const base = (
    await required<Checkpoint>(actor.store, "checkpoint", proposal.checkpointId)
  ).data;
  const current = currentSources(actor);
  const sources = new Map<string, SourceVersion>();
  const changes = new Map<string, DraftChange>();
  for (const step of applied) {
    const key = sourceKey(step.source);
    const live = await current(step.source);
    if (!live || fieldHash(live, step.fields) !== step.after)
      throw new Error(
        "The published wording changed. Review the current source before reversing it.",
      );
    const saved = await observation(actor, base, step.source);
    if (
      step.previous === undefined &&
      (saved.status !== "captured" ||
        sourceHash(saved.version, step.fields) !== step.before)
    )
      throw new Error(
        "This receipt does not contain the exact previous wording.",
      );
    const change = changes.get(key) ?? { source: step.source };
    for (const field of step.fields) {
      const original =
        step.previous ??
        (saved.status === "captured" ? fieldValue(saved.version, field) : "");
      if (field === "priority" && !original)
        throw new Error("The earlier priority is unavailable.");
      change[field === "priority" ? "priorityId" : field] = original;
    }
    changes.set(key, change);
    sources.set(key, live);
  }
  for (const source of base.sources) {
    const key = sourceKey(source);
    if (sources.has(key)) continue;
    const version = await current(source);
    if (version) sources.set(key, version);
  }
  return {
    sources: [...sources.values()],
    changes: [...changes.values()],
    template: proposal.template,
  };
}

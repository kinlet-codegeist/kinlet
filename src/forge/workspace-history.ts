import {
  requireName,
  type Branch,
  type BranchRevision,
  type Checkpoint,
} from "../domain/workspace";
import { canSeeDraft, sourceAccess } from "./workspace-evidence";
import {
  command,
  observation,
  recordId,
  required,
  type Actor,
} from "./workspace-resolver";

command("workspace.forkRevision", async (actor: Actor, payload) => {
  const id = recordId(payload.requestId);
  const from = recordId(payload.branchId);
  const name = requireName(payload.name);
  const revision = payload.revision;
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  )
    throw new Error("Choose a saved branch revision to fork.");
  const origin = (await required<Branch>(actor.store, "branch", from)).data;
  const base = (
    await required<Checkpoint>(actor.store, "checkpoint", origin.checkpointId)
  ).data;
  const original = (
    await required<BranchRevision>(
      actor.store,
      "revision",
      from + ":" + revision,
    )
  ).data;
  const read = sourceAccess(actor);
  for (const change of original.changes) {
    if (
      (await observation(actor, base, change.source)).status !== "captured" ||
      !(await canSeeDraft(change, read))
    )
      throw new Error(
        "A source in this revision is unavailable to your account.",
      );
  }
  const createdAt = new Date().toISOString();
  const branch = {
    id,
    name,
    checkpointId: base.id,
    createdAt,
    revision: 0,
    forkedFrom: { branchId: from, revision },
    ...(origin.repair && {
      repair: origin.repair,
      requiredEdits: origin.requiredEdits,
      predecessorId: origin.predecessorId,
      reviewTemplate: origin.reviewTemplate,
    }),
  };
  await actor.store.insert("branch", id, branch);
  const stored = (await required<typeof branch>(actor.store, "branch", id))
    .data;
  if (
    stored.name !== name ||
    stored.forkedFrom?.branchId !== from ||
    stored.forkedFrom?.revision !== revision
  )
    throw new Error("This branch request is already in use.");
  await actor.store.insert(
    "revision",
    id + ":1",
    {
      author: actor.id,
      requestId: id,
      createdAt,
      revision: 1,
      changes: original.changes,
    },
    id,
    1,
  );
  return { id };
});

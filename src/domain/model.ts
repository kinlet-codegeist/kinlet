import type {
  Artifact,
  AttentionItem,
  Branch,
  Change,
  ContextPack,
  FieldName,
  Publication,
  Resolution,
  WorkspaceState,
} from "./types";

export const now = () => new Date().toISOString();
export const uid = (prefix: string) =>
  `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
export const copy = <T>(value: T): T => structuredClone(value);
export const nextCheckpointId = (s: WorkspaceState) =>
  `C${Math.max(0, ...s.checkpoints.map((c) => Number(c.id.replace("C", "")) || 0)) + 1}`;
export const fieldLabel = (field: FieldName) =>
  field === "description"
    ? "Description"
    : field === "title"
      ? "Summary / title"
      : "Priority";
export function isConflict(
  change: Change,
  artifacts: Record<string, Artifact>,
): boolean {
  const current = artifacts[change.artifactId]?.[change.field];
  return (
    current !== undefined &&
    current !== change.before &&
    current !== change.after &&
    change.before !== change.after
  );
}
export function branchChanges(s: WorkspaceState, branch: Branch): Change[] {
  const base = s.checkpoints.find((c) => c.id === branch.baseId);
  if (!base) return [];
  return Object.values(branch.draft).flatMap((a) =>
    (["title", "description", "priority"] as FieldName[]).flatMap((field) => {
      const before = base.artifacts[a.id]?.[field];
      return a.editable && before !== undefined && before !== a[field]
        ? [
            {
              id: `${a.id}-${field}`,
              artifactId: a.id,
              field,
              before,
              after: a[field],
            },
          ]
        : [];
    }),
  );
}
export function getAttention(s: WorkspaceState): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const p of s.publications.filter((p) => p.status === "partial"))
    items.push({
      id: `recovery-${p.id}`,
      kind: "recovery",
      title: "A publication needs verification",
      description:
        "Some sample records were updated. Verify the remaining update before continuing.",
      minutes: 5,
      priority: 100,
      label: "Recovery needed",
      route: `/publications/${p.id}`,
      sourceIds: [],
      mandatory: true,
    });
  for (const p of s.proposals.filter((p) => p.status === "submitted")) {
    const conflicts = p.changes.filter((c) => isConflict(c, s.artifacts));
    const stale = conflicts.length > 0;
    items.push({
      id: `review-${p.id}`,
      kind: stale ? "drift" : "proposal",
      title: stale
        ? `Source changes affect ${p.title}`
        : p.title,
      description: stale
        ? `Work started from ${p.checkpointId}, and a proposed field has changed since then. Compare both versions before publishing.`
        : "Choose which changes to publish to Main.",
      minutes: stale ? 5 : 2,
      priority: stale ? 89 : 62,
      label: stale ? "Context changed" : "Ready to review",
      route: `/reviews/${p.id}`,
      sourceIds: [...new Set(p.changes.map((c) => c.artifactId))],
      runId: p.runId,
    });
  }
  for (const q of s.questions.filter((q) => !q.answer))
    items.push({
      id: q.id,
      kind: "question",
      title: q.title,
      description: q.description,
      minutes: 2,
      priority: 54,
      label: "Your decision",
      route: `/sessions/${q.runId}`,
      sourceIds: ["policy"],
      runId: q.runId,
    });
  return items
    .filter((i) => !s.dismissed.includes(i.id))
    .sort(
      (a, b) =>
        Number(s.pinned.includes(b.id)) - Number(s.pinned.includes(a.id)) ||
        b.priority - a.priority,
    );
}
export function budgetAttention(
  items: AttentionItem[],
  budget: number,
  pinned: string[],
): { selected: AttentionItem[]; remaining: AttentionItem[]; total: number } {
  const chosen = new Set<string>();
  let total = 0;
  for (const i of items.filter((i) => i.mandatory || pinned.includes(i.id))) {
    chosen.add(i.id);
    total += i.minutes;
  }
  for (const i of [...items]
    .filter((i) => !chosen.has(i.id))
    .sort(
      (a, b) =>
        b.priority / b.minutes - a.priority / a.minutes ||
        b.priority - a.priority,
    )) {
    if (total + i.minutes <= budget) {
      chosen.add(i.id);
      total += i.minutes;
    }
  }
  return {
    selected: items.filter((i) => chosen.has(i.id)),
    remaining: items.filter((i) => !chosen.has(i.id)),
    total,
  };
}
export function activity(
  s: WorkspaceState,
  title: string,
  detail: string,
  kind: "checkpoint" | "branch" | "run" | "review",
) {
  s.activities.unshift({ id: uid("activity"), title, detail, kind, at: now() });
}
export function capture(
  s: WorkspaceState,
  title: string,
  description = "",
  ids?: string[],
): string {
  const id = nextCheckpointId(s);
  s.checkpoints.push({
    id,
    title,
    description,
    createdAt: now(),
    author: s.settings.reviewer,
    kind: "observation",
    parentId: s.observedId || undefined,
    artifacts: copy(
      Object.fromEntries(
        Object.entries(s.artifacts).filter(
          ([key]) => !ids || ids.includes(key),
        ),
      ),
    ),
  });
  if (!ids || ids.length === Object.keys(s.artifacts).length) s.observedId = id;
  activity(s, `Checkpoint ${id} saved`, title, "checkpoint");
  return id;
}
export function createBranch(
  s: WorkspaceState,
  name: string,
  objective: string,
  baseId: string,
): string {
  const base = s.checkpoints.find((c) => c.id === baseId);
  if (!base) throw new Error("Choose an available checkpoint.");
  if (!name.trim()) throw new Error("Give your branch a name.");
  if (
    s.branches.some((b) => b.name.toLowerCase() === name.trim().toLowerCase())
  )
    throw new Error("A branch with that name already exists.");
  const id = uid("branch");
  s.branches.push({
    id,
    name: name.trim(),
    objective,
    baseId,
    revision: 1,
    draft: copy(base.artifacts),
    status: "open",
    createdAt: now(),
    owner: s.settings.reviewer,
    color: ["blue", "violet", "teal"][s.branches.length % 3],
    commitIds: [],
  });
  activity(
    s,
    "An alternative takes shape",
    `${name} · branched from ${baseId}`,
    "branch",
  );
  return id;
}
export function saveArtifact(
  s: WorkspaceState,
  branchId: string,
  artifactId: string,
  patch: Partial<Pick<Artifact, "title" | "description" | "priority">>,
  expectedRevision: number,
) {
  const b = s.branches.find((b) => b.id === branchId);
  if (!b) throw new Error("This branch is unavailable.");
  if (b.revision !== expectedRevision)
    throw new Error("This branch changed. Reopen it before saving your draft.");
  if (!b.draft[artifactId]?.editable)
    throw new Error("This source is read-only.");
  Object.assign(b.draft[artifactId], patch);
  b.revision += 1;
  b.status = "open";
  activity(
    s,
    "Branch draft saved",
    `${b.name} · revision ${b.revision}`,
    "branch",
  );
}
export function prepareContext(
  s: WorkspaceState,
  branchId: string,
  objective: string,
  instructions: string,
  sourceIds: string[],
): string {
  if (s.flags.aiUnavailable)
    throw new Error(
      "Sample agent responses are turned off. You can still edit the draft.",
    );
  if (s.flags.accessLost && sourceIds.includes("policy"))
    throw new Error(
      "One selected source is unavailable. Remove it or restore sample access.",
    );
  const b = s.branches.find((b) => b.id === branchId);
  if (!b || !objective.trim() || sourceIds.length === 0)
    throw new Error("Choose a branch, objective, and at least one source.");
  const pack: ContextPack = {
    id: uid("ctx"),
    branchId,
    revision: b.revision,
    checkpointId: b.baseId,
    objective,
    instructions,
    sourceIds,
    sources: copy(
      Object.fromEntries(
        sourceIds.filter((id) => b.draft[id]).map((id) => [id, b.draft[id]]),
      ),
    ),
    createdAt: now(),
  };
  s.contexts.push(pack);
  activity(
    s,
    "Agent context prepared",
    `${b.name} · ${sourceIds.length} sources`,
    "run",
  );
  return pack.id;
}
export function createProposal(
  s: WorkspaceState,
  branchId: string,
  title: string,
  summary: string,
  runId?: string,
): string {
  const b = s.branches.find((b) => b.id === branchId);
  if (!b) throw new Error("Branch not found.");
  const changes = branchChanges(s, b);
  if (!changes.length)
    throw new Error("Make and save a change before submitting a proposal.");
  const cid = nextCheckpointId(s);
  s.checkpoints.push({
    id: cid,
    title,
    description: summary,
    author: runId ? "Codex" : s.settings.reviewer,
    kind: "commit",
    createdAt: now(),
    artifacts: copy(b.draft),
    parentId: b.commitIds.at(-1) || b.baseId,
    branchId,
  });
  b.commitIds.push(cid);
  b.status = "review";
  const id = uid("proposal");
  s.proposals.push({
    id,
    title,
    summary,
    branchId,
    runId,
    checkpointId: b.baseId,
    changes,
    createdAt: now(),
    status: "submitted",
    resolutions: {},
  });
  activity(s, "A proposal is ready for review", title, "review");
  return id;
}
export function simulateAgent(s: WorkspaceState, contextId: string): string {
  if (s.flags.aiUnavailable)
    throw new Error(
      "Simulated AI is unavailable. Try the manual draft flow or change the demo scenario.",
    );
  const ctx = s.contexts.find((c) => c.id === contextId);
  const b = s.branches.find((b) => b.id === ctx?.branchId);
  if (!ctx || !b)
    throw new Error("Prepare context before starting a sample agent run.");
  if (b.revision !== ctx.revision)
    throw new Error(
      "The branch has changed since this context was prepared. Prepare a new context pack.",
    );
  const id = uid("run");
  const target =
    b.draft.checkout ||
    Object.values(b.draft).find((a) => a.kind === "issue" && a.editable);
  if (!target)
    throw new Error("Include an editable task to try the sample agent.");
  const guest = `${ctx.objective} ${ctx.instructions}`
    .toLowerCase()
    .includes("guest");
  target.description = guest
    ? "Build checkout with guest purchases enabled. Creating an account is optional. Preserve PayPal, never store card details, and test successful purchases, failed payments, and receipt delivery."
    : `${target.description}\n\nImplementation plan: follow the captured specification, preserve the payment provider, add acceptance tests, and document outstanding decisions.\n\nTask objective: ${ctx.objective}`;
  if (guest && b.draft.design)
    b.draft.design.description =
      "## Guest checkout\nCustomers can purchase without creating an account. Offer account creation after purchase.\n\n## Payment and privacy\nUse PayPal. Never store raw card details.\n\n## Acceptance criteria\nVerify guest purchase, receipt delivery, and payment failure recovery.";
  b.revision += 1;
  s.runs.push({
    id,
    provider: "Codex",
    title: ctx.objective,
    branchId: b.id,
    checkpointId: ctx.checkpointId,
    contextId,
    status: "review",
    createdAt: now(),
    events: [
      {
        title: "Context supplied",
        description: `${ctx.sourceIds.length} versioned sample sources supplied.`,
        time: "Just now",
        provenance: "recorded",
      },
      {
        title: "Sample implementation prepared",
        description:
          "The sample agent prepared a draft from the supplied sources.",
        time: "Just now",
        provenance: "reported",
      },
      {
        title: "Branch draft saved",
        description: `Revision ${b.revision} saved independently from Main.`,
        time: "Just now",
        provenance: "recorded",
      },
      {
        title: "Proposal submitted",
        description: "The draft is ready for your review.",
        time: "Just now",
        provenance: "recorded",
      },
    ],
  });
  return createProposal(
    s,
    b.id,
    guest ? "Guest checkout implementation" : "Implementation plan",
    `Prepared from ${ctx.checkpointId} using ${ctx.sourceIds.length} captured sources. This is a simulated agent proposal.`,
    id,
  );
}
export function beginPublication(
  s: WorkspaceState,
  proposalId: string,
  selected: string[],
  resolutions: Record<string, Resolution>,
): string {
  const p = s.proposals.find((p) => p.id === proposalId);
  if (!p || p.status === "published")
    throw new Error("This proposal is no longer available for publication.");
  if (!selected.length) throw new Error("Select at least one change.");
  const existing = s.publications.find(
    (pub) => pub.proposalId === p.id && pub.status !== "complete",
  );
  if (existing) return existing.id;
  const groups: Record<string, Publication["steps"][number]> = {};
  for (const c of p.changes.filter((c) => selected.includes(c.id))) {
    if (s.flags.accessLost && c.artifactId === "policy")
      throw new Error("A selected source is unavailable.");
    if (isConflict(c, s.artifacts) && !resolutions[c.id])
      throw new Error("Resolve the selected conflicts before publishing.");
    const value = resolutions[c.id]?.value ?? c.after;
    if (!groups[c.artifactId])
      groups[c.artifactId] = {
        artifactId: c.artifactId,
        changes: [],
        status: "pending",
      };
    groups[c.artifactId].changes.push({
      field: c.field,
      expected: s.artifacts[c.artifactId][c.field],
      value,
    });
  }
  const id = uid("publication");
  s.publications.push({
    id,
    proposalId,
    createdAt: now(),
    steps: Object.values(groups),
    status: "prepared",
  });
  p.status = "publishing";
  p.resolutions = copy(resolutions);
  p.receiptId = id;
  return id;
}
export function executeStep(s: WorkspaceState, publicationId: string): boolean {
  const pub = s.publications.find((p) => p.id === publicationId);
  if (!pub) throw new Error("Publication not found.");
  if (pub.status === "complete") return true;
  const step = pub.steps.find((step) => step.status !== "verified");
  if (!step) return finishPublication(s, pub);
  const index = pub.steps.indexOf(step);
  if (s.flags.partialPublish && index === 1) {
    step.status = "needs_verification";
    step.error =
      "Simulated connection interruption. Verify the remaining sample record before retrying.";
    pub.status = "partial";
    const proposal = s.proposals.find((p) => p.id === pub.proposalId);
    if (proposal) proposal.status = "partial";
    return false;
  }
  const artifact = s.artifacts[step.artifactId];
  if (
    !artifact ||
    step.changes.some(
      (c) => artifact[c.field] !== c.expected && artifact[c.field] !== c.value,
    )
  ) {
    step.status = "needs_verification";
    step.error =
      "The sample source changed after review. A fresh review is needed.";
    pub.status = "partial";
    return false;
  }
  const alreadyPresent = step.changes.every(
    (c) => artifact[c.field] === c.value,
  );
  step.alreadyPresent = alreadyPresent;
  for (const c of step.changes) {
    if (c.field === "priority")
      artifact.priority = c.value as Artifact["priority"];
    else artifact[c.field] = c.value;
  }
  if (!alreadyPresent) {
    artifact.version += 1;
    artifact.updatedAt = now();
  }
  step.status = "verified";
  step.error = undefined;
  pub.status = "running";
  if (pub.steps.every((st) => st.status === "verified"))
    return finishPublication(s, pub);
  return true;
}
function finishPublication(s: WorkspaceState, pub: Publication): boolean {
  if (pub.status === "complete") return true;
  const proposal = s.proposals.find((p) => p.id === pub.proposalId)!;
  pub.status = "complete";
  proposal.status = "published";
  const branch = s.branches.find((b) => b.id === proposal.branchId);
  if (branch)
    branch.status =
      pub.steps.reduce((n, st) => n + st.changes.length, 0) <
      proposal.changes.length
        ? "partial"
        : "published";
  const id = capture(
    s,
    `Published: ${proposal.title}`,
    "Reviewed sample changes applied to local Main. No real Jira or Confluence records were changed.",
  );
  const checkpoint = s.checkpoints.find((c) => c.id === id)!;
  checkpoint.kind = "publication";
  checkpoint.branchId = proposal.branchId;
  pub.checkpointId = id;
  if (proposal.runId) {
    const run = s.runs.find((r) => r.id === proposal.runId);
    if (run) run.status = "finished";
  }
  activity(
    s,
    "Reviewed changes published",
    `${proposal.title} · ${id}`,
    "review",
  );
  return true;
}
export function formatDate(
  value: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Date(value).toLocaleDateString(
    "en-US",
    options || { month: "short", day: "numeric" },
  );
}

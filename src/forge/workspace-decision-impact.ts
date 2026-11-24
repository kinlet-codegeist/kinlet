import { createHash } from "node:crypto";
import {
  analyzeDecision,
  decisionLimits,
  decisionPassages,
  type DecisionFollowUps,
  type DecisionOption,
  type DecisionSource,
  type DecisionSources,
} from "../domain/decision-impact";
import {
  requireName,
  validNativeId,
  workspaceLimits,
  type BranchRevision,
  type Checkpoint,
  type SourceVersion,
} from "../domain/workspace";
import { plainText } from "../platform/atlassian-text";
import {
  branchState,
  command,
  createWorkspaceBranch,
  forEachBatch,
  observation,
  recordId,
  saveCapturedCheckpoint,
  type Actor,
} from "./workspace-resolver";
import {
  captureSource,
  fitsWorkspace,
  jiraSourceVersion,
  resolveIssue,
} from "./workspace-sources";

type DecisionSeed = {
  planId: string;
  anchorId: string;
  original: string;
  option: DecisionOption;
};

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const stableId = (hash: string) =>
  [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");

function decisionSource({
  source,
  key,
  title,
  version,
  body,
}: SourceVersion): DecisionSource {
  return { source, key, title, version, text: plainText(body) };
}

function inputs({ anchorKey, planId }: Record<string, unknown>) {
  if (
    typeof anchorKey !== "string" ||
    !/^[A-Z][A-Z0-9_]{0,29}-[1-9]\d{0,11}$/.test(anchorKey) ||
    !validNativeId(planId)
  )
    throw new Error(
      "Enter a Jira ticket key and a Confluence page from this site.",
    );
  return { anchorKey, planId };
}

async function readDecisionSources(
  actor: Actor,
  { anchorKey, planId }: ReturnType<typeof inputs>,
) {
  const [anchor, plan] = await Promise.all([
    resolveIssue(actor.client, actor.project, anchorKey, true).then(
      jiraSourceVersion,
    ),
    captureSource(actor.client, actor.project, {
      kind: "confluence",
      id: planId,
    }),
  ]);
  if (!fitsWorkspace(plan) || !fitsWorkspace(anchor))
    throw new Error(
      "The selected plan or Jira ticket exceeds the capture limit.",
    );
  const ids = [...new Set(anchor.related?.map((item) => item.id) ?? [])].filter(
    (id) => id !== anchor.source.id && validNativeId(id),
  );
  const candidates = ids.slice(0, decisionLimits.candidates);
  const readable = new Map<string, SourceVersion>();
  await forEachBatch(candidates, async (id) => {
    try {
      const version = await captureSource(actor.client, actor.project, {
        kind: "jira",
        id,
      });
      if (fitsWorkspace(version)) readable.set(id, version);
    } catch {
      // Leave out tickets that are inaccessible or outside this Jira project.
    }
  });
  const tickets = candidates
    .flatMap((id) => {
      const version = readable.get(id);
      return version ? [version] : [];
    })
    .slice(0, decisionLimits.tickets);
  if (!tickets.length)
    throw new Error(
      "Link at least one readable ticket from this project to the starting ticket in Jira.",
    );
  const versions = [plan, anchor, ...tickets];
  const preview: DecisionSources = {
    plan: decisionSource(plan),
    tickets: tickets.map(decisionSource),
    omitted: ids.length - tickets.length,
    signature: digest(versions.map(decisionSource)),
  };
  return { preview, versions };
}

command(
  "workspace.decisionSources",
  async (actor, payload) =>
    (await readDecisionSources(actor, inputs(payload))).preview,
);

function wording(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > decisionLimits.wording
  )
    throw new Error(
      "Enter decision wording within the displayed length limit.",
    );
  return value.trim();
}

function readOption(value: unknown): DecisionOption {
  const option = (value ?? {}) as Partial<DecisionOption>;
  return { name: requireName(option.name), wording: wording(option.wording) };
}

command("workspace.saveDecisionBranches", async (actor, payload) => {
  const requestId = recordId(payload.requestId);
  const target = inputs(payload);
  const original = wording(payload.original);
  const first = readOption(payload.first);
  const second = readOption(payload.second);
  const signature = payload.signature;
  if (
    typeof signature !== "string" ||
    !/^[a-f\d]{64}$/.test(signature) ||
    first.name.toLowerCase() === second.name.toLowerCase() ||
    new Set(
      [original, first.wording, second.wording].map((value) =>
        value.toLowerCase(),
      ),
    ).size !== 3
  )
    throw new Error(
      "Compare two options with different names and different wording.",
    );
  const checkpointId = stableId(
    digest([
      "decision-checkpoint",
      actor.id,
      requestId,
      target,
      signature,
      original,
      first,
      second,
    ]),
  );
  const prior = await actor.store.get<Checkpoint>("checkpoint", checkpointId);
  let versions: SourceVersion[];
  if (prior?.data.finishedAt) {
    if (prior.data.author !== actor.id)
      throw new Error("Open your own decision comparison.");
    const saved = await Promise.all(
      prior.data.sources.map((source) =>
        observation(actor, prior.data, source),
      ),
    );
    versions = saved.flatMap((item) =>
      item.status === "captured" ? [item.version] : [],
    );
    if (versions.length !== prior.data.sources.length)
      throw new Error(
        "A source is no longer available. Load the sources again.",
      );
  } else {
    const current = await readDecisionSources(actor, target);
    if (current.preview.signature !== signature)
      throw new Error(
        "The plan or linked tickets changed. Load the sources again before saving.",
      );
    versions = current.versions;
  }
  const [plan, anchor] = versions;
  const text = plainText(plan.body);
  if (!decisionPassages(text).includes(original))
    throw new Error("Choose a single occurrence of the current plan wording.");
  const start = text.indexOf(original);
  const prepared = [first, second].map((option, index) => {
    const branchId = stableId(digest(["decision-branch", checkpointId, index]));
    const body =
      text.slice(0, start) +
      option.wording +
      text.slice(start + original.length);
    const changes = [{ source: plan.source, body }];
    if (!fitsWorkspace(changes, workspaceLimits.draftBytes))
      throw new Error("The alternative plan is too large to save as a draft.");
    return {
      branchId,
      seed: {
        planId: plan.source.id,
        anchorId: anchor.source.id,
        original,
        option,
      },
      changes,
    };
  });
  if (!prior?.data.finishedAt)
    await saveCapturedCheckpoint(
      actor,
      checkpointId,
      "Decision comparison",
      versions,
    );
  return Promise.all(
    prepared.map(async ({ branchId, seed, changes }) => {
      await actor.store.insert("decision_seed", branchId, seed);
      await actor.store.insert(
        "revision",
        branchId + ":1",
        {
          revision: 1,
          requestId,
          author: actor.id,
          createdAt: new Date().toISOString(),
          changes,
        } satisfies BranchRevision & { requestId: string },
        branchId,
      );
      return createWorkspaceBranch(actor, {
        requestId: branchId,
        checkpointId,
        name: seed.option.name,
      });
    }),
  );
});

export async function readDecisionFollowUps(
  actor: Actor,
  branchId: string,
  base: Checkpoint,
  visible?: SourceVersion[],
): Promise<DecisionFollowUps | null> {
  const seed = (await actor.store.get<DecisionSeed>("decision_seed", branchId))
    ?.data;
  if (!seed) return null;
  const versions =
    visible ??
    (
      await Promise.all(
        base.sources.map((source) => observation(actor, base, source)),
      )
    ).flatMap((item) => (item.status === "captured" ? [item.version] : []));
  const plan = versions.find(
    ({ source }) => source.kind === "confluence" && source.id === seed.planId,
  );
  if (!plan) return null;
  const linkedTickets = versions.filter(
    ({ source }) => source.kind === "jira" && source.id !== seed.anchorId,
  );
  const unavailable =
    base.sources.filter(
      ({ kind, id }) => kind === "jira" && id !== seed.anchorId,
    ).length - linkedTickets.length;
  return {
    plan: { id: plan.source.id, version: plan.version, title: plan.title },
    original: seed.original,
    option: seed.option,
    findings: analyzeDecision(
      decisionSource(plan),
      seed.original,
      seed.option,
      linkedTickets.map(decisionSource),
    ),
    unavailable,
  };
}

command("workspace.branchDecision", async (actor, payload) => {
  const id = recordId(payload.branchId);
  const { base } = await branchState(actor, id);
  return readDecisionFollowUps(actor, id, base);
});

import { route } from "@forge/api";
import { validNativeId, sourceKey, type SourceRef } from "../domain/workspace";
import { textDocument } from "../domain/editable-passages";
import { plainText } from "../platform/atlassian-text";
import { beginRepair, operationId, startFollowUp } from "./workspace-follow-up";
import { submitWorkspaceProposal } from "./workspace-publication";
import {
  command,
  recordId,
  required,
  saveWorkspaceDraft,
  branchState,
  type Actor,
} from "./workspace-resolver";
import { captureSource, resolvePage } from "./workspace-sources";

const signIn = "Require shoppers to sign in before payment.";
const guests = "Allow guest checkout.";
const retry = "Verify that a payment retry uses the original order.";
const initial = "Test checkout.";
const kind = "checkout-demo";
const policyText = (rule: string) => rule + "\n" + retry;
const payload = (data: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

type Demo = {
  owner: string;
  mode: "jira" | "confluence";
  space?: string;
  target?: SourceRef;
  policy?: SourceRef;
  pending?: "target" | "policy";
  policyWrite?: boolean;
  proposalId?: string;
};

async function owned(actor: Actor, id: string) {
  const row = await required<Demo>(actor.store, kind, id);
  if (row.data.owner !== actor.id)
    throw new Error("Open your own checkout demo.");
  return row;
}

async function advance(
  actor: Actor,
  id: string,
  row: Awaited<ReturnType<typeof owned>>,
  data: Demo,
) {
  if (!(await actor.store.replace(kind, id, row.seq, data)))
    throw new Error("Another request advanced this demo. Check progress.");
  return owned(actor, id);
}

function marker(id: string, slot: "target" | "policy") {
  return "kinlet-demo-" + id + "-" + slot;
}

function titleFor(id: string, slot: "target" | "policy") {
  return (
    "Kinlet demo " +
    id +
    (slot === "target" ? " · Checkout test" : " · Checkout policy")
  );
}

async function findCreated(
  actor: Actor,
  demo: Demo,
  id: string,
  slot: "target" | "policy",
): Promise<SourceRef | undefined> {
  let matches: { id: string }[];
  const confluence = slot === "policy" && demo.mode === "confluence";
  if (confluence) {
    if (!demo.space) throw new Error("The demo space is unavailable.");
    const response = await actor.client.requestConfluence(
      route`/wiki/api/v2/pages?space-id=${demo.space}&title=${titleFor(id, slot)}&status=current&limit=2`,
    );
    if (!response.ok)
      throw new Error("Could not verify the sample policy page.");
    matches = (await response.json()).results;
  } else {
    const jql =
      "project = " + actor.project + ' AND labels = "' + marker(id, slot) + '"';
    const response = await actor.client.requestJira(
      route`/rest/api/3/search/jql`,
      payload({ jql, fields: ["summary"], maxResults: 2 }),
    );
    if (!response.ok)
      throw new Error("Could not verify the sample Jira record.");
    matches = (await response.json()).issues.filter(
      (issue: { fields: { summary: string } }) =>
        issue.fields.summary === titleFor(id, slot),
    );
  }
  if (matches.length > 1)
    throw new Error("Multiple sample records match this run. Start a new run.");
  return validNativeId(matches[0]?.id)
    ? { kind: confluence ? "confluence" : "jira", id: matches[0].id }
    : undefined;
}

async function createRecord(
  actor: Actor,
  id: string,
  row: Awaited<ReturnType<typeof owned>>,
  slot: "target" | "policy",
) {
  const demo = row.data;
  if (demo[slot]) return row;
  if (demo.pending === slot) {
    const recovered = await findCreated(actor, demo, id, slot);
    if (!recovered)
      throw new Error(
        "Jira or Confluence has yet to confirm the sample record. Check progress again or start a separate run.",
      );
    return advance(actor, id, row, {
      ...demo,
      [slot]: recovered,
      pending: undefined,
    });
  }
  const confluence = slot === "policy" && demo.mode === "confluence";
  let issueType: string | undefined;
  if (!confluence) {
    const response = await actor.client.requestJira(
      route`/rest/api/3/issue/createmeta/${actor.project}/issuetypes`,
    );
    if (!response.ok)
      throw new Error(
        "Jira could not list issue types you can create in this project.",
      );
    const { issueTypes } = await response.json();
    const standard = issueTypes.filter(
      ({ subtask }: { subtask: boolean }) => !subtask,
    );
    issueType = (
      standard.find(({ name }: { name: string }) => name === "Task") ??
      standard[0]
    )?.id;
    if (!validNativeId(issueType))
      throw new Error(
        "Choose a Jira project where you can create standard issues.",
      );
  }
  const reserved = await advance(actor, id, row, { ...demo, pending: slot });
  const body = textDocument(slot === "target" ? initial : policyText(signIn));
  const response = confluence
    ? await actor.client.requestConfluence(
        route`/wiki/api/v2/pages`,
        payload({
          spaceId: demo.space,
          status: "current",
          title: titleFor(id, slot),
          body: {
            representation: "atlas_doc_format",
            value: JSON.stringify(body),
          },
        }),
      )
    : await actor.client.requestJira(
        route`/rest/api/3/issue`,
        payload({
          fields: {
            summary: titleFor(id, slot),
            description: body,
            project: { id: actor.project },
            issuetype: { id: issueType },
            labels: [marker(id, slot)],
          },
        }),
      );
  if (!response.ok) {
    if (
      response.status >= 400 &&
      response.status < 500 &&
      ![408, 429].includes(response.status)
    ) {
      await advance(actor, id, reserved, { ...demo, pending: undefined });
      throw new Error(
        "Atlassian could not create the sample record. Check creation permissions and required fields, or open the built-in example.",
      );
    }
    throw new Error(
      "Atlassian has yet to confirm creation. Choose Check progress before retrying.",
    );
  }
  const record = await response.json();
  if (!validNativeId(record.id))
    throw new Error("The sample record ID is pending. Choose Check progress.");
  return advance(actor, id, reserved, {
    ...demo,
    [slot]: { kind: confluence ? "confluence" : "jira", id: record.id },
    pending: undefined,
  });
}

command("workspace.setupCheckoutDemo", async (actor, input) => {
  const id = recordId(input.requestId);
  if (input.confirmed !== true)
    throw new Error("Confirm where to create the sample records.");
  if (!(await actor.store.get(kind, id))) {
    const seed: Demo = { owner: actor.id, mode: "jira" };
    if (input.pageId) {
      if (!validNativeId(input.pageId))
        throw new Error("Enter a numeric Confluence page ID.");
      const page = await resolvePage(actor.client, input.pageId);
      if (!validNativeId(page.spaceId))
        throw new Error("Choose a readable page in your demo space.");
      seed.mode = "confluence";
      seed.space = page.spaceId;
    }
    await actor.store.insert(kind, id, seed);
  }
  let row = await owned(actor, id);
  row = await createRecord(actor, id, row, "target");
  row = await createRecord(actor, id, row, "policy");
  const { target, policy, proposalId } = row.data;
  if (proposalId || !target || !policy) return row.data;
  const branchId = operationId(actor, id, "demo-branch", []);
  const proposal = operationId(actor, id, "demo-proposal", []);
  if (!(await actor.store.get("branch", branchId))) {
    const sources = await Promise.all(
      [target, policy].map((source) =>
        captureSource(actor.client, actor.project, source),
      ),
    );
    await startFollowUp(actor, branchId, "Checkout demo", sources, [], {});
  }
  await saveWorkspaceDraft(actor, {
    branchId,
    expectedRevision: 0,
    requestId: operationId(actor, id, "demo-draft", []),
    change: {
      source: target,
      title: "Verify sign-in before payment",
      body: retry,
      citations: {
        title: [{ source: policy, quote: signIn, required: true }],
        body: [{ source: policy, quote: retry, required: true }],
      },
    },
  });
  await submitWorkspaceProposal(actor, {
    branchId,
    expectedRevision: 1,
    requestId: proposal,
    name: "Review checkout edits",
  });
  return (await advance(actor, id, row, { ...row.data, proposalId: proposal }))
    .data;
});

command("workspace.checkoutDemoStatus", async (actor, input) => {
  const { data } = await owned(actor, recordId(input.requestId));
  const target =
    data.target &&
    (await captureSource(actor.client, actor.project, data.target));
  const policy =
    data.policy &&
    (await captureSource(actor.client, actor.project, data.policy));
  return {
    ...data,
    ticketKey: target?.key,
    policyChanged: plainText(policy?.body ?? null) === policyText(guests),
    retryApplied: plainText(target?.body ?? null) === retry,
    repaired: target?.title === "Verify guest checkout",
  };
});

command("workspace.changeCheckoutDemoPolicy", async (actor, input) => {
  const id = recordId(input.requestId);
  const row = await owned(actor, id);
  const { data } = row;
  if (!data.policy || !data.proposalId)
    throw new Error("Finish creating the checkout demo first.");
  const policy = data.policy;
  const source = await captureSource(actor.client, actor.project, policy);
  if (plainText(source.body) === policyText(guests)) return { changed: true };
  if (plainText(source.body) !== policyText(signIn))
    throw new Error(
      "The sample policy was edited outside the demo. Start a new run.",
    );
  if (source.title !== titleFor(id, "policy"))
    throw new Error(
      "The sample policy was renamed. Start a separate sample run.",
    );
  if (data.policyWrite)
    throw new Error(
      "Atlassian has yet to confirm the policy write. Check progress.",
    );
  const reserved = await advance(actor, id, row, {
    ...data,
    policyWrite: true,
  });
  const body = textDocument(policyText(guests));
  const request = payload(
    policy.kind === "jira"
      ? { fields: { description: body } }
      : {
          id: policy.id,
          title: source.title,
          status: "current",
          version: { number: Number(source.version) + 1 },
          body: {
            representation: "atlas_doc_format",
            value: JSON.stringify(body),
          },
        },
  );
  const response =
    policy.kind === "jira"
      ? await actor.client.requestJira(route`/rest/api/3/issue/${policy.id}`, {
          ...request,
          method: "PUT",
        })
      : await actor.client.requestConfluence(
          route`/wiki/api/v2/pages/${policy.id}`,
          { ...request, method: "PUT" },
        );
  if (!response.ok) {
    if (
      response.status >= 400 &&
      response.status < 500 &&
      ![408, 429].includes(response.status)
    )
      await advance(actor, id, reserved, data);
    throw new Error(
      "Atlassian could not confirm the sample policy change. Check progress and edit permissions.",
    );
  }
  return { changed: true };
});

command("workspace.prepareCheckoutDemoRepair", async (actor, input) => {
  const id = recordId(input.requestId);
  const { data } = await owned(actor, id);
  if (!data.target || !data.policy || !data.proposalId)
    throw new Error("Finish creating the checkout demo first.");
  const target = await captureSource(actor.client, actor.project, data.target);
  if (plainText(target.body) !== retry)
    throw new Error("Apply the independent retry check first.");
  const branch = await beginRepair(
    actor,
    data.proposalId,
    sourceKey(data.target) + ":title",
  );
  const savedId = operationId(actor, id, "demo-repair-draft", []);
  const proposalId = operationId(actor, id, "demo-repair-proposal", []);
  if (await actor.store.get("proposal", proposalId)) return { id: proposalId };
  const { head } = await branchState(actor, branch.id);
  if (head?.revision !== 1 && head?.requestId !== savedId)
    throw new Error("Open the repair branch to review your saved edits.");
  const { revision } = await saveWorkspaceDraft(actor, {
    branchId: branch.id,
    expectedRevision: 1,
    requestId: savedId,
    change: {
      source: data.target,
      title: "Verify guest checkout",
      citations: {
        title: [{ source: data.policy, quote: guests, required: true }],
      },
    },
  });
  return submitWorkspaceProposal(actor, {
    branchId: branch.id,
    requestId: proposalId,
    expectedRevision: revision,
    name: "Review the guest checkout title",
  });
});

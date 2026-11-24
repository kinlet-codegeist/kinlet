import api, { route } from "@forge/api";
import { decisionFiles, readDecisionRecord } from "../domain/decision-records";
import {
  parseTicketGoals,
  ticketGoalsOperation,
  ticketGoalsQuery,
  ticketGoalVariables,
} from "../domain/ticket-goals";
import { plainText, type AdfNode } from "../platform/atlassian-text";
import type { CheckpointFile } from "../platform/jira-checkpoints";

const ticketKeyPattern = /^[A-Z][A-Z0-9_]{0,29}-[1-9]\d{0,11}$/;
const idPattern = /^[1-9]\d{0,19}$/;
const cloudIdPattern = /^[0-9a-f-]{36}$/i;
const descriptionLimit = 3500;
type Inputs = {
  issueKey?: unknown;
  decisionId?: unknown;
  context?: { cloudId?: unknown };
};
type ForgeContext = { installContext?: string };
type JiraIssue = {
  id: string;
  key: string;
  self?: string;
  fields: {
    summary: string;
    description?: AdfNode | null;
    attachment?: CheckpointFile[];
  };
};
type Client = ReturnType<typeof api.asUser>;

function jiraOrigin(self: string | undefined) {
  if (!self) return;
  try {
    const url = new URL(self);
    if (
      url.protocol === "https:" &&
      url.pathname.startsWith("/rest/api/3/issue/")
    )
      return url.origin;
  } catch {
    // The ticket key and attachment ID still identify the record.
  }
}

async function loadGoals(client: Client, cloudId: string, issueId: string) {
  try {
    const response = await client.requestTeamworkGraph(
      ticketGoalsQuery,
      ticketGoalVariables(cloudId, issueId),
      ticketGoalsOperation,
      undefined,
      { "X-Query-Context": "ari:cloud:platform::site/" + cloudId },
    );
    if (!response.ok) return { status: "unavailable" };
    return { status: "available", ...parseTicketGoals(await response.json()) };
  } catch {
    return { status: "unavailable" };
  }
}

async function loadRecordedDecision(
  client: Client,
  issue: JiraIssue,
  cloudId: string,
  requestedId: string,
  origin?: string,
) {
  const files = (issue.fields.attachment ?? []).map((file) => ({
    ...file,
    id: String(file.id),
  }));
  const refs = decisionFiles(files)
    .filter(({ file }) => !requestedId || file.id === requestedId)
    .sort(
      (a, b) =>
        Date.parse(b.file.created) - Date.parse(a.file.created) ||
        b.file.id.localeCompare(a.file.id, undefined, { numeric: true }),
    );
  if (!refs.length)
    return { status: requestedId ? "unavailable" : "no_saved_decision" };
  let entry;
  try {
    entry = await readDecisionRecord(
      refs[0],
      issue.id,
      cloudId,
      async (file) => {
        const response = await client.requestJira(
          route`/rest/api/3/attachment/content/${file.id}?redirect=false`,
        );
        return response.ok ? await response.json() : null;
      },
    );
  } catch {
    return { status: "unavailable" };
  }
  if (!entry) return { status: "unavailable" };
  const decision = {
    status: "available",
    id: entry.id,
    sourceUrl: origin
      ? origin + "/rest/api/3/attachment/content/" + entry.id
      : null,
    checkpointId: entry.checkpointId,
    reviewedAt: entry.created,
    reviewedBy: entry.author,
    outcome: entry.decision?.outcome ?? null,
    reason: entry.decision?.reason ?? null,
    reviewedPlanVersion: entry.version,
    changedTicketFields: entry.decision
      ? [
          ...(entry.decision.wording.summary !== issue.fields.summary
            ? ["summary"]
            : []),
          ...(entry.decision.wording.description !==
          plainText(issue.fields.description ?? null)
            ? ["description"]
            : []),
        ]
      : null,
  };
  try {
    const response = await client.requestConfluence(
      route`/wiki/api/v2/pages/${entry.pageId}`,
    );
    if (response.ok) {
      const head = await response.json();
      const version = head.version?.number;
      if (
        String(head.id) === entry.pageId &&
        head.status === "current" &&
        typeof head.title === "string" &&
        Number.isSafeInteger(version) &&
        version >= entry.version
      ) {
        return {
          ...decision,
          reviewedPlan: {
            status:
              version === entry.version
                ? "at_reviewed_version"
                : "newer_version_published",
            currentVersion: version,
            title: head.title,
            url: origin
              ? origin + "/wiki/pages/viewpage.action?pageId=" + entry.pageId
              : null,
          },
        };
      }
    }
  } catch {
    // A user with Jira access can still read their saved decision.
  }
  return { ...decision, reviewedPlan: { status: "unavailable" } };
}

export async function readDecisionContext(
  payload: Inputs = {},
  context?: ForgeContext,
) {
  const key =
    typeof payload.issueKey === "string"
      ? payload.issueKey.trim().toUpperCase()
      : "";
  if (!ticketKeyPattern.test(key))
    return JSON.stringify({ error: "Enter a Jira ticket key such as PAY-12." });
  const decisionId = payload.decisionId ?? "";
  if (
    typeof decisionId !== "string" ||
    (decisionId && !idPattern.test(decisionId))
  )
    return JSON.stringify({
      error:
        "Enter a numeric saved decision ID or omit it for the latest review.",
    });

  const installedCloud = context?.installContext?.match(
    /^ari:cloud:(?:jira|confluence)::site\/([0-9a-f-]{36})$/i,
  )?.[1];
  const cloudId = installedCloud ?? payload.context?.cloudId;
  if (typeof cloudId !== "string" || !cloudIdPattern.test(cloudId))
    return JSON.stringify({
      error:
        "The Atlassian site context was unavailable. Open Kinlet on the site and reconnect the tool.",
    });
  try {
    const client = api.asUser();
    const response = await client.requestJira(
      route`/rest/api/3/issue/${key}?fields=summary,description,attachment`,
    );
    if (response.ok) {
      const issue = (await response.json()) as JiraIssue;
      if (
        !idPattern.test(issue.id) ||
        !ticketKeyPattern.test(issue.key) ||
        typeof issue.fields?.summary !== "string"
      )
        return JSON.stringify({ error: "Jira returned an incomplete ticket." });
      const origin = jiraOrigin(issue.self);
      const description = plainText(issue.fields.description ?? null);
      const [decision, linkedGoals] = await Promise.all([
        loadRecordedDecision(client, issue, cloudId, decisionId, origin),
        loadGoals(client, cloudId, issue.id),
      ]);
      return JSON.stringify({
        ticket: {
          key: issue.key,
          summary: issue.fields.summary,
          description: description.slice(0, descriptionLimit),
          descriptionTruncated: description.length > descriptionLimit,
          url: origin ? origin + "/browse/" + issue.key : null,
        },
        decision,
        linkedGoals,
      });
    }
  } catch {
    // Keep the response scoped to the caller and avoid disclosing inaccessible records.
  }
  return JSON.stringify({
    error:
      "Couldn’t read this Jira ticket as your account. Check the key, Jira access and app consent for this site.",
  });
}

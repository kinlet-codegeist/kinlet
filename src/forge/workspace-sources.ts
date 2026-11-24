import api, { route } from "@forge/api";
import {
  validNativeId,
  workspaceLimits,
  type SourceRef,
  type SourceVersion,
} from "../domain/workspace";
import type { AdfNode } from "../platform/atlassian-text";

export type UserApi = ReturnType<typeof api.asUser>;
type JiraRecord = {
  id: string;
  key: string;
  fields: {
    project: { id: string };
    summary: string;
    description: AdfNode | null;
    updated: string;
    status?: { name: string };
    priority?: { id: string; name: string };
    issuelinks?: Array<{
      type?: { name: string; inward: string; outward: string };
      inwardIssue?: { id: string; key: string };
      outwardIssue?: { id: string; key: string };
    }>;
  };
};

export async function workspacePermissions(client: UserApi, project: string) {
  const response = await client.requestJira(
    route`/rest/api/3/mypermissions?projectId=${project}&permissions=BROWSE_PROJECTS,ADMINISTER_PROJECTS`,
  );
  const permissions = response.ok && (await response.json()).permissions;
  if (permissions?.BROWSE_PROJECTS?.havePermission !== true)
    throw new Error("You need permission to browse this Jira project.");
  return permissions.ADMINISTER_PROJECTS?.havePermission === true;
}

export async function resolveIssue(
  client: UserApi,
  project: string | undefined,
  idOrKey: string,
  body = false,
) {
  const fields = body
    ? "project,summary,description,updated,status,priority,issuelinks"
    : "project";
  const response = await client.requestJira(
    route`/rest/api/3/issue/${idOrKey}?fields=${fields}`,
  );
  if (!response.ok) throw new Error("Jira ticket unavailable.");
  const issue = (await response.json()) as JiraRecord;
  if (
    (project !== undefined && String(issue.fields?.project?.id) !== project) ||
    !validNativeId(String(issue.id))
  )
    throw new Error("Jira ticket unavailable in this project.");
  return issue;
}

export async function canEditSource(client: UserApi, source: SourceRef) {
  try {
    if (source.kind === "jira") {
      const response = await client.requestJira(
        route`/rest/api/3/mypermissions?issueId=${source.id}&permissions=EDIT_ISSUES`,
      );
      return (
        response.ok &&
        (await response.json()).permissions?.EDIT_ISSUES?.havePermission ===
          true
      );
    }
    const response = await client.requestConfluence(
      route`/wiki/api/v2/pages/${source.id}/operations`,
    );
    return (
      response.ok &&
      (await response.json()).operations?.some(
        (item: { operation: string }) => item.operation === "update",
      ) === true
    );
  } catch {
    return false;
  }
}

export async function resolvePage(client: UserApi, id: string, body = false) {
  const response = body
    ? await client.requestConfluence(
        route`/wiki/api/v2/pages/${id}?body-format=atlas_doc_format`,
      )
    : await client.requestConfluence(route`/wiki/api/v2/pages/${id}`);
  if (!response.ok) throw new Error("Confluence page unavailable.");
  const page = await response.json();
  if (
    String(page.id) !== id ||
    page.status !== "current" ||
    !Number.isSafeInteger(page.version?.number)
  )
    throw new Error("Confluence page unavailable.");
  return page;
}

export async function canReadSource(
  client: UserApi,
  project: string,
  source: SourceRef,
) {
  try {
    if (source.kind === "jira") await resolveIssue(client, project, source.id);
    else await resolvePage(client, source.id);
    return true;
  } catch {
    return false;
  }
}

export async function captureSource(
  client: UserApi,
  project: string,
  source: SourceRef,
): Promise<SourceVersion> {
  if (source.kind === "jira") {
    return jiraSourceVersion(
      await resolveIssue(client, project, source.id, true),
    );
  }
  const page = await resolvePage(client, source.id, true);
  const raw = page.body?.atlas_doc_format?.value;
  const body = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (
    body?.type !== "doc" ||
    !Array.isArray(body.content) ||
    typeof page.title !== "string"
  )
    throw new Error("Published page text unavailable.");
  return {
    source,
    key: source.id,
    title: page.title,
    body,
    version: String(page.version.number),
  };
}

export function jiraSourceVersion({
  id,
  key,
  fields,
}: JiraRecord): SourceVersion {
  return {
    source: { kind: "jira", id: String(id) },
    key,
    title: fields.summary,
    body: fields.description ?? null,
    version: fields.updated,
    status: fields.status?.name,
    priority: fields.priority,
    related: fields.issuelinks
      ?.flatMap((link) => {
        const item = link.inwardIssue ?? link.outwardIssue;
        if (!item || !link.type) return [];
        return [
          {
            id: String(item.id),
            key: item.key,
            type: link.inwardIssue ? link.type.inward : link.type.outward,
          },
        ];
      })
      .slice(0, 50),
  };
}

export function fitsWorkspace(
  value: unknown,
  limit = workspaceLimits.sourceBytes,
) {
  return Buffer.byteLength(JSON.stringify(value), "utf8") <= limit;
}

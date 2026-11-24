import { plainText, type AdfNode } from "./atlassian-text";
import { isPlanReference, type PlanReference } from "./confluence-plan";
import { runtime } from "./runtime";

export type TicketText = { summary: string; description: string };
export type CheckpointFile = {
  id: string;
  filename: string;
  created: string;
  size: number;
  author?: { displayName?: string };
};
export type IndexedTicket = {
  id: string;
  key: string;
  summary: string;
  files: CheckpointFile[];
  reviews: CheckpointFile[];
  branchFiles: CheckpointFile[];
  inboxFiles: CheckpointFile[];
};
export type Ticket = IndexedTicket &
  TicketText & { updated: string; descriptionDoc: AdfNode | null };
export type SavedTicket = TicketText & {
  issueId: string;
  sourceUpdated: string;
} & (
    | { format: "kinlet.ticket.v1"; plan?: undefined }
    | { format: "kinlet.ticket.v2"; plan: PlanReference }
  );

export const maxAttachmentBytes = 1024 * 1024;
const checkpointName = /^kinlet-checkpoint-[0-9a-f-]{36}\.json$/;
const api = "/rest/api/3";
const pathId = encodeURIComponent;

async function jira(path: string, init?: RequestInit) {
  const { requestJira } = await import("@forge/bridge");
  let response: Response;
  try {
    response = await requestJira(api + path, init);
  } catch {
    throw new Error("Jira could not be reached. Refresh and try again.");
  }
  if (response.ok) return response;
  const saving = path.endsWith("/attachments");
  if (response.status === 401)
    throw new Error("Sign in to Jira and reopen Kinlet.");
  if (init?.method === "PUT" && response.status === 403)
    throw new Error(
      "Jira denied the edit. You need permission to edit this ticket.",
    );
  if (init?.method === "PUT" && [409, 412].includes(response.status))
    throw new Error(
      "The ticket changed. Reopen the review before applying this draft.",
    );
  if (init?.method === "PUT" && [400, 422].includes(response.status))
    throw new Error(
      "Jira rejected the update. Check the wording and whether the selected fields can be edited.",
    );
  if (response.status === 403)
    throw new Error(
      saving
        ? "Jira denied the upload. Check your Create attachments permission and the site's attachment settings."
        : "Jira denied access to this ticket or attachment.",
    );
  if (response.status === 404)
    throw new Error(
      "This ticket or checkpoint is unavailable to your account.",
    );
  if (response.status === 429)
    throw new Error("Jira is receiving too many requests. Try again shortly.");
  if (response.status === 413)
    throw new Error(
      "This checkpoint exceeds the Jira site's attachment limit.",
    );
  throw new Error(
    "Jira could not complete the request (HTTP " + response.status + ").",
  );
}

export async function recentTickets(): Promise<
  Array<{ key: string; fields: { summary: string } }>
> {
  if (!runtime.projectId || !/^\d+$/.test(runtime.projectId))
    throw new Error("Open Kinlet in a Jira project.");
  const query = new URLSearchParams({
    jql: "project = " + runtime.projectId + " ORDER BY updated DESC",
    fields: "summary",
    maxResults: "15",
  });
  return (await (await jira("/search/jql?" + query)).json()).issues;
}

export async function readAttentionSignals(key: string) {
  if (!runtime.projectKey || !key.startsWith(runtime.projectKey + "-"))
    throw new Error("Choose a ticket in this project.");
  const response = await jira(
    "/issue/" + pathId(key) + "?fields=project,duedate,issuelinks",
  );
  const { fields } = await response.json();
  if (String(fields.project?.id) !== runtime.projectId)
    throw new Error("Ticket unavailable.");
  const dependentKeys = new Set<string>();
  for (const link of fields.issuelinks ?? []) {
    const relatedKey = link.outwardIssue?.key;
    if (
      link.type?.outward?.toLowerCase() === "blocks" &&
      typeof relatedKey === "string" &&
      relatedKey.startsWith(runtime.projectKey + "-")
    )
      dependentKeys.add(relatedKey);
  }
  return {
    due:
      typeof fields.duedate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(fields.duedate)
        ? fields.duedate
        : undefined,
    dependents: dependentKeys.size,
  };
}

export async function readTicket(key: string): Promise<Ticket> {
  key = key.trim().toUpperCase();
  if (
    !runtime.projectKey ||
    !key.startsWith(runtime.projectKey.toUpperCase() + "-") ||
    !/^\d+$/.test(key.slice(runtime.projectKey.length + 1))
  ) {
    throw new Error(
      "Enter a ticket key from this project, such as " +
        runtime.projectKey +
        "-1.",
    );
  }
  const data = await (
    await jira(
      "/issue/" +
        pathId(key) +
        "?fields=summary,description,updated,project,attachment",
    )
  ).json();
  if (String(data.fields.project?.id) !== runtime.projectId)
    throw new Error("This ticket belongs to a different Jira project.");
  return {
    ...indexTicket(data),
    description: plainText(data.fields.description),
    descriptionDoc: data.fields.description ?? null,
    updated: data.fields.updated,
  };
}

type IssueRecord = {
  id: string;
  key: string;
  fields: { summary: string; attachment?: CheckpointFile[] };
};
function indexTicket(data: IssueRecord): IndexedTicket {
  const attachments = (data.fields.attachment ?? []).map((file) => ({
    ...file,
    id: String(file.id),
  }));
  const files = attachments
    .filter((file) => checkpointName.test(file.filename))
    .sort(
      (a, b) =>
        Date.parse(b.created) - Date.parse(a.created) ||
        b.id.localeCompare(a.id, undefined, { numeric: true }),
    );
  return {
    id: String(data.id),
    key: data.key,
    summary: data.fields.summary,
    files,
    branchFiles: attachments.filter((file) =>
      file.filename.startsWith("kinlet-branch-"),
    ),
    inboxFiles: attachments.filter((file) =>
      file.filename.startsWith("kinlet-inbox-"),
    ),
    reviews: attachments.filter((file) =>
      file.filename.startsWith("kinlet-review-"),
    ),
  };
}

export async function* projectAttachmentTickets(
  signal: AbortSignal,
  reconcileIssue?: string,
) {
  if (!runtime.projectId || !/^\d+$/.test(runtime.projectId))
    throw new Error("Open Kinlet in a Jira project.");
  const query = new URLSearchParams({
    jql:
      "project = " +
      runtime.projectId +
      " AND attachments IS NOT EMPTY ORDER BY key ASC",
    fields: "summary,attachment",
    maxResults: "50",
  });
  if (reconcileIssue) query.set("reconcileIssues", reconcileIssue);
  const tokens = new Set<string>();
  while (!signal.aborted) {
    const page = await (await jira("/search/jql?" + query)).json();
    if (signal.aborted) return;
    if (!Array.isArray(page.issues))
      throw new Error("Jira returned an incomplete ticket list.");
    yield (page.issues as IssueRecord[]).map(indexTicket);
    if (page.isLast || (!page.nextPageToken && page.isLast !== false)) return;
    if (!page.nextPageToken || tokens.has(page.nextPageToken))
      throw new Error("Jira couldn’t finish listing project tickets.");
    tokens.add(page.nextPageToken);
    query.set("nextPageToken", page.nextPageToken);
  }
}

export function sameText(left: TicketText, right: TicketText) {
  return (
    left.summary === right.summary && left.description === right.description
  );
}

export async function readCheckpoint(
  ticket: IndexedTicket,
  file: CheckpointFile,
): Promise<SavedTicket> {
  if (
    file.size > maxAttachmentBytes ||
    !ticket.files.some((f) => f.id === file.id)
  )
    throw new Error("This file is not a supported Kinlet checkpoint.");
  const data = await readAttachmentJson(file);
  if (
    !(
      data?.format === "kinlet.ticket.v1" ||
      (data?.format === "kinlet.ticket.v2" && isPlanReference(data.plan))
    ) ||
    data.issueId !== ticket.id ||
    typeof data.summary !== "string" ||
    typeof data.description !== "string" ||
    typeof data.sourceUpdated !== "string"
  ) {
    throw new Error(
      "This attachment does not contain a valid checkpoint for this ticket.",
    );
  }
  return data.format === "kinlet.ticket.v1"
    ? { ...data, plan: undefined }
    : data;
}

export async function attachCheckpoint(
  ticket: Ticket,
  filename: string,
  plan?: PlanReference,
): Promise<CheckpointFile> {
  const data: SavedTicket = {
    ...(plan
      ? { format: "kinlet.ticket.v2" as const, plan }
      : { format: "kinlet.ticket.v1" as const }),
    issueId: ticket.id,
    sourceUpdated: ticket.updated,
    summary: ticket.summary,
    description: ticket.description,
  };
  return attachJson(ticket.id, filename, data);
}

export async function readAttachmentJson(file: CheckpointFile) {
  const response = await jira(
    "/attachment/content/" + pathId(file.id) + "?redirect=false",
  );
  return response.json().catch(() => null);
}

export async function attachJson(
  issueId: string,
  filename: string,
  data: unknown,
): Promise<CheckpointFile> {
  const file = new File([JSON.stringify(data)], filename, {
    type: "application/json",
  });
  if (file.size > maxAttachmentBytes)
    throw new Error("The attachment exceeds Kinlet’s 1 MB limit.");
  const body = new FormData();
  body.append("file", file);
  const response = await jira("/issue/" + pathId(issueId) + "/attachments", {
    method: "POST",
    headers: { "X-Atlassian-Token": "no-check" },
    body,
  });
  const files = await response.json();
  const saved =
    Array.isArray(files) &&
    files.find((f: CheckpointFile) => f.filename === filename && f.id);
  if (!saved)
    throw new Error(
      "Jira did not confirm the attachment. Refresh the ticket to check whether it was saved.",
    );
  return { ...saved, id: String(saved.id) };
}

export type IssueHistoryMetadata = {
  type: string;
  activityDescription: string;
  extraData: Record<string, string>;
};

export type TicketFieldUpdate = {
  summary?: string;
  description?: AdfNode | null;
};

async function writeTicketFields(
  ticket: Pick<Ticket, "id" | "key">,
  fields: TicketFieldUpdate,
  historyMetadata?: IssueHistoryMetadata,
) {
  await jira("/issue/" + pathId(ticket.id), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields, historyMetadata }),
  });
  const confirmed = await readTicket(ticket.key);
  if (
    confirmed.id !== ticket.id ||
    (fields.summary !== undefined && confirmed.summary !== fields.summary) ||
    (fields.description !== undefined &&
      confirmed.description !== plainText(fields.description))
  ) {
    throw new Error(
      "Jira’s current wording differs from the submitted draft. Reopen the review to see the saved ticket.",
    );
  }
  return confirmed;
}

export function pendingBranchFields(
  baseline: Pick<Ticket, "id" | "summary" | "descriptionDoc">,
  fresh: Pick<Ticket, "id" | "summary" | "description" | "descriptionDoc">,
  fields: TicketFieldUpdate,
) {
  const update: TicketFieldUpdate = {};
  const stale =
    "The ticket changed after the review. Refresh the review and select the fields again.";
  if (fresh.id !== baseline.id) throw new Error(stale);
  if (fields.summary !== undefined && fresh.summary !== fields.summary) {
    if (fresh.summary !== baseline.summary) throw new Error(stale);
    update.summary = fields.summary;
  }
  if (
    fields.description !== undefined &&
    fresh.description !== plainText(fields.description)
  ) {
    if (
      JSON.stringify(fresh.descriptionDoc) !==
      JSON.stringify(baseline.descriptionDoc)
    )
      throw new Error(stale);
    update.description = fields.description;
  }
  return update;
}

export async function commitBranchFields(
  baseline: Pick<Ticket, "id" | "key" | "summary" | "descriptionDoc">,
  fields: TicketFieldUpdate,
  metadata: IssueHistoryMetadata,
) {
  const fresh = await readTicket(baseline.key);
  const update = pendingBranchFields(baseline, fresh, fields);
  const changed = Object.keys(update) as (keyof TicketFieldUpdate)[];
  const ticket = changed.length
    ? await writeTicketFields(fresh, update, metadata)
    : fresh;
  return { ticket, changed };
}

export type IssueChange = {
  id: string;
  created: string;
  author?: { displayName?: string };
  items?: {
    field?: string;
    fieldId?: string;
    fieldtype?: string;
    fromString?: string | null;
    toString?: string | null;
  }[];
  historyMetadata?: Partial<IssueHistoryMetadata>;
};

export async function* issueChanges(issueId: string, signal: AbortSignal) {
  let startAt = 0;
  while (!signal.aborted) {
    const query = new URLSearchParams({
      startAt: String(startAt),
      maxResults: "100",
    });
    const response = await jira(
      "/issue/" + pathId(issueId) + "/changelog?" + query,
    );
    const page = await response.json();
    if (signal.aborted) return;
    if (page.startAt !== startAt || !Array.isArray(page.values))
      throw new Error("Jira returned an incomplete ticket history. Try again.");
    yield page.values as IssueChange[];
    startAt += page.values.length;
    if (
      page.isLast === true ||
      (Number.isSafeInteger(page.total) && startAt >= page.total)
    )
      return;
    if (!page.values.length)
      throw new Error(
        "Jira could not finish loading the ticket history. Try again.",
      );
  }
}

export async function commitReviewedDescription(
  baseline: Ticket,
  expected: AdfNode,
  historyMetadata?: IssueHistoryMetadata,
) {
  // Re-read Jira immediately before PUT; the edit endpoint accepts a complete ADF description.
  const fresh = await readTicket(baseline.key);
  if (fresh.id !== baseline.id || fresh.summary !== baseline.summary) {
    throw new Error(
      "The ticket changed. Reopen this review before applying the draft.",
    );
  }
  const currentDoc = JSON.stringify(fresh.descriptionDoc);
  // A retry after an interrupted response must not append the same passage twice.
  if (currentDoc === JSON.stringify(expected)) return fresh;
  if (currentDoc !== JSON.stringify(baseline.descriptionDoc)) {
    throw new Error(
      "The ticket description changed while you were drafting. Reopen the review to see the latest wording.",
    );
  }
  return writeTicketFields(fresh, { description: expected }, historyMetadata);
}

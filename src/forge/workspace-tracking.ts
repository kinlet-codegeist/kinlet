import api, { route } from "@forge/api";
import { type Scope, type SourceRef, validNativeId } from "../domain/workspace";
import { command, forEachBatch, type Actor } from "./workspace-resolver";
import { projectStore, trackingProjects } from "./workspace-store";
import { workspacePermissions } from "./workspace-sources";
import { captureAutomaticSource } from "./workspace-tracking-capture";

type Tracking = {
  enabled: boolean;
  owner: string;
  phase: "issues" | "pages" | "linked";
  cursor?: string;
  spaceId?: string;
  linkedIndex?: number;
  lastSuccessfulSync?: string;
  lastError?: string;
};

function requireManager(actor: Actor) {
  if (!actor.canManage)
    throw new Error("A project administrator must manage tracking.");
}

async function backgroundActor(project: string, owner: string): Promise<Actor> {
  const client = api.asUser(owner);
  if (!(await workspacePermissions(client, project)))
    throw new Error(
      "The tracking account no longer administers this project. An administrator must restart tracking.",
    );
  return {
    id: owner,
    project,
    canManage: true,
    client,
    store: projectStore(project),
  };
}

function nextCursor(next: unknown) {
  if (typeof next !== "string" || !next) return undefined;
  try {
    const cursor = new URL(next, "https://example.invalid").searchParams.get(
      "cursor",
    );
    if (!cursor)
      throw new Error("Confluence returned an invalid continuation cursor.");
    return cursor;
  } catch {
    throw new Error("Confluence returned an invalid continuation cursor.");
  }
}

// Advance one bounded page. Cursor changes use compare-and-swap: duplicate or
// concurrent invocations can repeat a page but cannot move the cursor backward.
export async function reconcileTracking(project: string) {
  const store = projectStore(project);
  const row = await store.get<Tracking>("tracking", "current");
  if (!row?.data.enabled) return;
  const previous = row.data;
  try {
    const actor = await backgroundActor(project, previous.owner);
    let next: Tracking = { ...previous, lastError: undefined };
    if (previous.phase === "issues") {
      const jql = `project = ${project} ORDER BY key ASC`;
      const response = previous.cursor
        ? await actor.client.requestJira(
            route`/rest/api/3/search/jql?jql=${jql}&fields=id&maxResults=10&nextPageToken=${previous.cursor}`,
          )
        : await actor.client.requestJira(
            route`/rest/api/3/search/jql?jql=${jql}&fields=id&maxResults=10`,
          );
      if (!response.ok)
        throw new Error("Jira search is unavailable. Retry synchronization.");
      const result = await response.json();
      if (!Array.isArray(result.issues))
        throw new Error("Jira returned an incomplete task list.");
      await forEachBatch(result.issues, async (issue: { id?: unknown }) => {
        if (!validNativeId(String(issue.id)))
          throw new Error("Jira returned an invalid task ID.");
        await captureAutomaticSource(actor, {
          kind: "jira",
          id: String(issue.id),
        });
      });
      const token = result.nextPageToken;
      if (token !== undefined && typeof token !== "string")
        throw new Error("Jira returned an invalid continuation cursor.");
      if (result.isLast === false && !token)
        throw new Error(
          "Jira returned an incomplete task list. Retry synchronization.",
        );
      if (token && token === previous.cursor)
        throw new Error(
          "Jira returned a repeated continuation cursor. Retry synchronization.",
        );
      next = token
        ? { ...next, cursor: token }
        : { ...next, phase: "pages", cursor: undefined };
    } else if (previous.phase === "pages") {
      let spaceId = previous.spaceId;
      if (!spaceId) {
        const response = await actor.client.requestJira(
          route`/rest/api/3/project/${project}`,
        );
        if (!response.ok) throw new Error("Could not read the Jira project.");
        const projectInfo = await response.json();
        if (
          typeof projectInfo.key !== "string" ||
          !/^[A-Z][A-Z0-9_]*$/.test(projectInfo.key)
        )
          throw new Error("The Jira project key is unavailable.");
        const spaces = await actor.client.requestConfluence(
          route`/wiki/api/v2/spaces?keys=${projectInfo.key}&status=current&limit=1`,
        );
        if (!spaces.ok)
          throw new Error(
            "Confluence space discovery is unavailable. Check access and retry.",
          );
        const result = await spaces.json();
        if (!Array.isArray(result.results))
          throw new Error("Confluence returned an incomplete space list.");
        if (!result.results.length) {
          next = {
            ...next,
            phase: "linked",
            cursor: undefined,
            linkedIndex: 0,
          };
        } else {
          spaceId = String(result.results[0].id);
          if (!validNativeId(spaceId))
            throw new Error("Confluence returned an invalid space ID.");
          next = { ...next, spaceId };
        }
      }
      if (spaceId) {
        const response = previous.cursor
          ? await actor.client.requestConfluence(
              route`/wiki/api/v2/spaces/${spaceId}/pages?status=current&limit=10&cursor=${previous.cursor}`,
            )
          : await actor.client.requestConfluence(
              route`/wiki/api/v2/spaces/${spaceId}/pages?status=current&limit=10`,
            );
        if (!response.ok)
          throw new Error(
            "Confluence page discovery is unavailable. Check access and retry.",
          );
        const result = await response.json();
        if (!Array.isArray(result.results))
          throw new Error("Confluence returned an incomplete page list.");
        await forEachBatch(result.results, async (page: { id?: unknown }) => {
          if (!validNativeId(String(page.id)))
            throw new Error("Confluence returned an invalid page ID.");
          await captureAutomaticSource(actor, {
            kind: "confluence",
            id: String(page.id),
          });
        });
        const cursor = nextCursor(result._links?.next);
        if (cursor && cursor === previous.cursor)
          throw new Error(
            "Confluence returned a repeated continuation cursor. Retry synchronization.",
          );
        next = cursor
          ? { ...next, cursor }
          : { ...next, phase: "linked", cursor: undefined, linkedIndex: 0 };
      }
    } else {
      const scope = await store.get<Scope>("scope", "current");
      const pages = (scope?.data.sources ?? []).filter(
        (source) => source.kind === "confluence",
      );
      const offset = previous.linkedIndex ?? 0;
      await forEachBatch(pages.slice(offset, offset + 10), (source) =>
        captureAutomaticSource(actor, source),
      );
      next =
        offset + 10 < pages.length
          ? { ...next, linkedIndex: offset + 10 }
          : {
              ...next,
              phase: "issues",
              cursor: undefined,
              linkedIndex: undefined,
              lastSuccessfulSync: new Date().toISOString(),
            };
    }
    await store.replace("tracking", "current", row.seq, next);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Synchronization failed. Retry or check permissions.";
    await store.replace("tracking", "current", row.seq, {
      ...previous,
      lastError: message,
    });
  }
}

command("workspace.trackingStatus", async (actor) => {
  const row = await actor.store.get<Tracking>("tracking", "current");
  if (!row) return { enabled: false };
  const { owner: _owner, ...status } = row.data;
  return status;
});

command("workspace.enableTracking", async (actor) => {
  requireManager(actor);
  const current = await actor.store.get<Tracking>("tracking", "current");
  const tracking: Tracking = {
    enabled: true,
    owner: actor.id,
    phase: "issues",
  };
  const saved = current
    ? await actor.store.replace("tracking", "current", current.seq, tracking)
    : await actor.store.insert("tracking", "current", tracking);
  if (!saved)
    throw new Error("Tracking settings changed. Reload and try again.");
  await reconcileTracking(actor.project);
  return { enabled: true };
});

command("workspace.retryTracking", async (actor) => {
  requireManager(actor);
  await reconcileTracking(actor.project);
  return { attempted: true };
});

command("workspace.disableTracking", async (actor) => {
  requireManager(actor);
  const current = await actor.store.get<Tracking>("tracking", "current");
  if (
    current &&
    !(await actor.store.replace("tracking", "current", current.seq, {
      ...current.data,
      enabled: false,
    }))
  )
    throw new Error("Tracking settings changed. Reload and try again.");
  return { enabled: false };
});

export async function reconcileAllTracking() {
  // Persist progress across invocations so a large installation cannot leave
  // projects later in the list waiting forever when the runtime budget expires.
  const registry = projectStore("0");
  const cursor = await registry.get<{ after: string }>(
    "tracking-cursor",
    "current",
  );
  let cursorSeq = cursor?.seq ?? 0;
  let after = cursor?.data.after ?? "";
  async function saveCursor(value: string) {
    const saved = cursorSeq
      ? await registry.replace("tracking-cursor", "current", cursorSeq, {
          after: value,
        })
      : await registry.insert("tracking-cursor", "current", { after: value });
    if (saved) cursorSeq++;
    return saved;
  }
  const started = Date.now();
  do {
    const projects = await trackingProjects(after);
    for (const project of projects) {
      const store = projectStore(project);
      const initial = await store.get<Tracking>("tracking", "current");
      if (initial?.data.enabled) {
        // Process multiple bounded pages per run without exceeding the Forge
        // invocation budget. Each page can be retried independently.
        for (let i = 0; i < 10 && Date.now() - started < 180_000; i++) {
          await reconcileTracking(project);
          const current = await store.get<Tracking>("tracking", "current");
          if (
            !current?.data.enabled ||
            current.data.lastError ||
            current.data.lastSuccessfulSync !== initial.data.lastSuccessfulSync
          )
            break;
        }
      }
      if (!(await saveCursor(project))) return;
      after = project;
      if (Date.now() - started >= 180_000) return;
    }
    if (projects.length < 25) {
      await saveCursor("");
      return;
    }
  } while (Date.now() - started < 180_000);
}

async function captureEvent(project: string, source: SourceRef) {
  const store = projectStore(project);
  const row = await store.get<Tracking>("tracking", "current");
  if (!row?.data.enabled) return;
  try {
    const actor = await backgroundActor(project, row.data.owner);
    await captureAutomaticSource(actor, source);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "An automatic capture failed. Retry synchronization.";
    await store.replace("tracking", "current", row.seq, {
      ...row.data,
      lastError: message,
    });
  }
}

export async function jiraTrackingEvent(event: {
  issue?: { id?: unknown; fields?: { project?: { id?: unknown } } };
}) {
  const id = String(event.issue?.id ?? "");
  const project = String(event.issue?.fields?.project?.id ?? "");
  if (validNativeId(id) && validNativeId(project))
    await captureEvent(project, { kind: "jira", id });
}

export async function confluenceTrackingEvent(event: {
  content?: { id?: unknown; space?: { id?: unknown } };
}) {
  const id = String(event.content?.id ?? "");
  const space = String(event.content?.space?.id ?? "");
  if (!validNativeId(id)) return;
  let after = "";
  do {
    const projects = await trackingProjects(after);
    for (const project of projects) {
      const store = projectStore(project);
      const tracking = await store.get<Tracking>("tracking", "current");
      if (!tracking?.data.enabled) continue;
      const scope = await store.get<Scope>("scope", "current");
      if (
        (validNativeId(space) && tracking.data.spaceId === space) ||
        scope?.data.sources.some(
          (source) => source.kind === "confluence" && source.id === id,
        )
      )
        await captureEvent(project, { kind: "confluence", id });
    }
    if (projects.length < 25) return;
    after = projects[projects.length - 1];
  } while (true);
}

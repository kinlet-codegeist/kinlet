import { route } from "@forge/api";
import { validNativeId, workspaceLimits } from "../domain/workspace";
import { command } from "./workspace-resolver";
import { resolvePage } from "./workspace-sources";

type FoundIssue = { id: string; key: string; fields?: { summary?: string } };
type FoundPage = { id: string; title: string };

// Discovery runs as the viewer, so suggestions never reveal inaccessible sources.
command("workspace.discover", async (actor) => {
  const projectResponse = await actor.client.requestJira(
    route`/rest/api/3/project/${actor.project}`,
  );
  if (!projectResponse.ok) throw new Error("Could not read this Jira project.");
  const project = await projectResponse.json();
  if (typeof project.key !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(project.key))
    throw new Error("The Jira project key is unavailable.");

  const jql = `project = ${actor.project} ORDER BY key ASC`;
  const issuesResponse = await actor.client.requestJira(
    route`/rest/api/3/search/jql?jql=${jql}&fields=summary&maxResults=${workspaceLimits.issues + 1}`,
  );
  if (!issuesResponse.ok)
    throw new Error("Could not find this project's Jira tasks.");
  const issuesResult = await issuesResponse.json();
  const foundIssues = Array.isArray(issuesResult.issues)
    ? issuesResult.issues
    : [];
  const issues = foundIssues
    .slice(0, workspaceLimits.issues)
    .map((issue: FoundIssue) => ({
      id: String(issue.id),
      key: String(issue.key),
      title: String(issue.fields?.summary ?? issue.key),
    }));

  let pages: Array<{ id: string; title: string }> = [];
  let pageError = "";
  let pagesTruncated = false;
  let relationshipsIncomplete = false;
  const candidates = new Map<string, { id: string; title: string }>();
  try {
    const spacesResponse = await actor.client.requestConfluence(
      route`/wiki/api/v2/spaces?keys=${project.key}&status=current&limit=1`,
    );
    if (!spacesResponse.ok) throw new Error();
    const spaces = await spacesResponse.json();
    const space = spaces.results?.[0];
    if (space && validNativeId(String(space.id))) {
      const response = await actor.client.requestConfluence(
        route`/wiki/api/v2/spaces/${String(space.id)}/pages?status=current&limit=${workspaceLimits.pages + 1}`,
      );
      if (!response.ok) throw new Error();
      const result = await response.json();
      const foundPages = (result.results ?? []).filter(
        (page: FoundPage) => String(page.id) !== String(space.homepageId),
      );
      pagesTruncated = !!result._links?.next;
      for (const page of foundPages) {
        const id = String(page.id);
        if (validNativeId(id))
          candidates.set(id, { id, title: String(page.title) });
      }
    }
  } catch {
    pageError =
      "Confluence suggestions are unavailable. Check access and try again.";
  }
  // Jira remote links may point to a Confluence space with a different key.
  // Resolve each page as the current viewer before suggesting it.
  let origin = "";
  try {
    origin = new URL(project.self).origin;
  } catch {
    // Without a trusted site origin, only same-key space pages are suggested.
  }
  if (origin) {
    for (let offset = 0; offset < issues.length; offset += 4) {
      await Promise.all(
        issues.slice(offset, offset + 4).map(async (issue: FoundIssue) => {
          try {
            const response = await actor.client.requestJira(
              route`/rest/api/3/issue/${issue.key}/remotelink`,
            );
            if (!response.ok) {
              relationshipsIncomplete = true;
              return;
            }
            const links = await response.json();
            if (!Array.isArray(links)) return;
            for (const link of links) {
              let url: URL;
              try {
                url = new URL(link.object?.url);
              } catch {
                continue;
              }
              const id =
                url.origin === origin &&
                url.pathname.match(
                  /^\/wiki\/spaces\/[^/]+\/pages\/([1-9]\d*)(?:\/|$)/i,
                )?.[1];
              if (!id || !validNativeId(id) || candidates.has(id)) continue;
              try {
                const page = await resolvePage(actor.client, id);
                candidates.set(id, { id, title: String(page.title) });
              } catch {
                /* Ignore links to inaccessible or unpublished pages. */
              }
            }
          } catch {
            relationshipsIncomplete = true;
            // A missing remote-link permission must not hide matching-space results.
          }
        }),
      );
    }
  }
  pagesTruncated ||= candidates.size > workspaceLimits.pages;
  pages = [...candidates.values()].slice(0, workspaceLimits.pages);
  return {
    issues,
    pages,
    pageError,
    issuesTruncated:
      foundIssues.length > workspaceLimits.issues ||
      Boolean(issuesResult.nextPageToken),
    pagesTruncated,
    relationshipsIncomplete,
  };
});

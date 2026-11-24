import { plainText } from "./atlassian-text";
import { runtime } from "./runtime";

export type PlanReference = { cloudId: string; id: string; version: number };
export type PlanVersion = {
  id: string;
  version: number;
  title: string;
  text: string;
};
export type PlanPair = { saved: PlanVersion; current: PlanVersion };

const isPageId = (id: unknown): id is string =>
  typeof id === "string" && /^[1-9]\d*$/.test(id);

export function isPlanReference(value: unknown): value is PlanReference {
  if (!value || typeof value !== "object") return false;
  const ref = value as Partial<PlanReference>;
  return (
    typeof ref.cloudId === "string" &&
    !!ref.cloudId &&
    isPageId(ref.id) &&
    typeof ref.version === "number" &&
    Number.isSafeInteger(ref.version) &&
    ref.version > 0
  );
}

export function parsePageId(input: string): string {
  const value = input.trim();
  if (isPageId(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a Confluence page URL or its numeric page ID.");
  }
  if (
    !runtime.siteUrl ||
    url.origin !== new URL(runtime.siteUrl).origin ||
    url.protocol !== "https:"
  ) {
    throw new Error(
      "Choose a Confluence page on this Jira site, or enter its page ID.",
    );
  }
  const id =
    url.pathname.match(
      /^\/wiki\/(?:spaces\/[^/]+\/)?pages\/(\d+)(?:\/|$)/,
    )?.[1] ??
    (url.pathname === "/wiki/pages/viewpage.action"
      ? url.searchParams.get("pageId")
      : null);
  if (!isPageId(id))
    throw new Error(
      "Open the page and copy its address from the browser, or enter its numeric page ID.",
    );
  return id;
}

async function fetchPage(id: string, includeText: boolean, version?: number) {
  if (!isPageId(id)) throw new Error("Invalid Confluence page ID.");
  const { requestConfluence } = await import("@forge/bridge");
  const query = new URLSearchParams();
  if (includeText) query.set("body-format", "atlas_doc_format");
  if (version !== undefined) query.set("version", String(version));
  let response: Response;
  try {
    response = await requestConfluence(
      "/wiki/api/v2/pages/" + id + "?" + query,
    );
  } catch {
    throw new Error(
      "Couldn’t reach Confluence. Check that Kinlet is connected to Confluence on this site and try again.",
    );
  }
  if (!response.ok) {
    if ([401, 403, 404, 410].includes(response.status))
      throw new Error(
        version
          ? "The saved page version is unavailable to your account. It may have been removed."
          : "Page unavailable. Check the page ID, your Confluence access, and this site's Kinlet connection.",
      );
    if (response.status === 429)
      throw new Error("Confluence is busy. Try refreshing in a moment.");
    throw new Error(
      "Couldn’t read the Confluence page (HTTP " + response.status + ").",
    );
  }
  const page = await response.json();
  if (
    String(page.id) !== id ||
    !Number.isSafeInteger(page.version?.number) ||
    page.version.number < 1 ||
    typeof page.title !== "string" ||
    (version !== undefined && page.version.number !== version) ||
    !(
      page.status === "current" ||
      (version !== undefined && page.status === "historical")
    )
  ) {
    throw new Error(
      "Confluence could not return the requested published version.",
    );
  }
  return page;
}

export async function readPlanHead(
  ref: PlanReference,
): Promise<Pick<PlanVersion, "version" | "title">> {
  if (ref.cloudId !== runtime.cloudId)
    throw new Error("The linked plan belongs to a different Atlassian site.");
  const page = await fetchPage(ref.id, false);
  return { version: page.version.number, title: page.title };
}

async function readPage(id: string, version?: number): Promise<PlanVersion> {
  const page = await fetchPage(id, true, version);
  const raw = page.body?.atlas_doc_format?.value;
  let doc;
  try {
    doc = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    /* handled below */
  }
  if (doc?.type !== "doc" || !Array.isArray(doc.content))
    throw new Error("The text of this page version is unavailable.");
  return {
    id,
    version: page.version.number,
    title: page.title,
    text: plainText(doc),
  };
}

export async function pinPlan(id: string): Promise<PlanReference> {
  if (!runtime.cloudId)
    throw new Error("Reopen Kinlet in Jira before linking a page.");
  const page = await readPage(id);
  return { cloudId: runtime.cloudId, id: page.id, version: page.version };
}

export function readPinnedPlan(ref: PlanReference): Promise<PlanVersion> {
  if (ref.cloudId !== runtime.cloudId)
    throw new Error("The linked plan belongs to a different Atlassian site.");
  return readPage(ref.id, ref.version);
}

export async function readPlanPair(ref: PlanReference): Promise<PlanPair> {
  if (ref.cloudId !== runtime.cloudId)
    throw new Error("The linked plan belongs to a different Atlassian site.");
  const current = await readPage(ref.id);
  const saved =
    current.version === ref.version
      ? current
      : await readPage(ref.id, ref.version);
  return { saved, current };
}

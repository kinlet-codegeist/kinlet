import type { AdfNode } from "../platform/atlassian-text";

export type Passage = { id: string; path: number[]; text: string };
export const newParagraph: Passage = { id: "append", path: [], text: "" };
export function textDocument(text: string): AdfNode {
  return {
    type: "doc",
    version: 1,
    content: [
      { type: "paragraph", content: text ? [{ type: "text", text }] : [] },
    ],
  };
}

export function editablePassages(doc: AdfNode | null): Passage[] {
  const out: Passage[] = [];
  function walk(parent: AdfNode, path: number[]) {
    for (const [index, node] of (parent.content ?? []).entries()) {
      const at = [...path, index];
      if (
        parent.type === "paragraph" &&
        node.type === "text" &&
        node.text &&
        !node.marks?.some((mark) =>
          ["link", "code", "annotation"].includes(mark.type),
        )
      ) {
        out.push({ id: at.join("."), path: at, text: node.text });
      } else if (
        node.content &&
        !["extension", "bodiedExtension", "multiBodiedExtension"].includes(
          node.type ?? "",
        )
      )
        walk(node, at);
    }
  }
  if (doc) walk(doc, []);
  return out;
}

export function applyPassage(
  doc: AdfNode | null,
  passage: Passage,
  wording: string,
): AdfNode {
  const next = doc
    ? structuredClone(doc)
    : { type: "doc", version: 1, content: [] };
  if (next.type !== "doc" || next.version !== 1 || !Array.isArray(next.content))
    throw new Error("This description uses an unsupported format.");
  const lines = wording.replace(/\r\n?/g, "\n").split("\n");
  if (passage.id === newParagraph.id) {
    if (!wording.trim()) throw new Error("Enter the wording to add.");
    for (const line of lines)
      next.content.push({
        type: "paragraph",
        ...(line && { content: [{ type: "text", text: line }] }),
      });
    return next;
  }
  let parent: AdfNode = next;
  for (const index of passage.path.slice(0, -1)) {
    const child = parent.content?.[index];
    if (!child)
      throw new Error(
        "The selected ticket passage changed. Reopen the review.",
      );
    parent = child;
  }
  const index = passage.path[passage.path.length - 1];
  const original = parent.content?.[index];
  if (
    parent.type !== "paragraph" ||
    !parent.content ||
    original?.type !== "text" ||
    original.text !== passage.text
  ) {
    throw new Error("The selected ticket passage changed. Reopen the review.");
  }
  const replacement: AdfNode[] = [];
  for (const [i, line] of lines.entries()) {
    if (i) replacement.push({ type: "hardBreak" });
    if (line) replacement.push({ ...original, text: line });
  }
  parent.content.splice(index, 1, ...replacement);
  if (!parent.content.length) delete parent.content;
  return next;
}

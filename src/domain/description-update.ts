import {
  applyPassage,
  editablePassages,
  newParagraph,
} from "./editable-passages";
import { plainText, type AdfNode } from "../platform/atlassian-text";

// A branch stores text. Only rebuild paragraphs when everything they encode
// is plain wording. Appending paragraphs can preserve an entire rich document.
export function descriptionUpdate(
  doc: AdfNode | null,
  target: string,
): { description: AdfNode | null } | undefined {
  if (
    doc &&
    (doc.type !== "doc" || doc.version !== 1 || !Array.isArray(doc.content))
  )
    return;
  const current = plainText(doc);
  if (doc && target.startsWith(current + "\n")) {
    const addition = target.slice(current.length + 1);
    if (addition.trim()) {
      const appended = applyPassage(doc, newParagraph, addition);
      if (plainText(appended) === target) return { description: appended };
    }
  }
  const onlyKeys = (node: AdfNode, keys: string[]) =>
    Object.keys(node).every((key) => keys.includes(key));
  const plainParagraph = (p: AdfNode) =>
    p.type === "paragraph" &&
    onlyKeys(p, ["type", "content"]) &&
    (p.content ?? []).every(
      (t) =>
        t.type === "text" &&
        typeof t.text === "string" &&
        onlyKeys(t, ["type", "text"]),
    );
  if (
    doc &&
    !(
      onlyKeys(doc, ["version", "type", "content"]) &&
      doc.content?.every(plainParagraph)
    )
  ) {
    let from = 0,
      end = current.length,
      to = target.length;
    while (from < end && from < to && current[from] === target[from]) from++;
    while (end > from && to > from && current[end - 1] === target[to - 1]) {
      end--;
      to--;
    }
    for (const passage of editablePassages(doc)) {
      if (end - from > passage.text.length) continue;
      const first = Math.max(0, end - passage.text.length);
      const nearby = current.slice(first, from + passage.text.length);
      const match = nearby.indexOf(passage.text);
      if (match < 0) continue;
      const offset = first + match;
      if (
        from === end &&
        (offset === from || offset + passage.text.length === end)
      )
        continue;
      // Repeated text can look identical in the projection while belonging to different marks.
      if (
        current.indexOf(passage.text) !== offset ||
        current.lastIndexOf(passage.text) !== offset
      )
        continue;
      const wording =
        passage.text.slice(0, from - offset) +
        target.slice(from, to) +
        passage.text.slice(end - offset);
      const next = applyPassage(doc, passage, wording);
      if (plainText(next) === target) return { description: next };
    }
    return;
  }
  if (!target) return { description: null };
  // Retain existing plain paragraphs outside the changed range.
  const paragraphs = doc?.content ?? [];
  const lines = target.split("\n");
  let start = 0,
    end = paragraphs.length,
    last = lines.length;
  while (
    start < end &&
    start < last &&
    plainText(paragraphs[start]) === lines[start]
  )
    start++;
  while (
    end > start &&
    last > start &&
    plainText(paragraphs[end - 1]) === lines[last - 1]
  ) {
    end--;
    last--;
  }
  return {
    description: {
      type: "doc",
      version: 1,
      content: [
        ...paragraphs.slice(0, start),
        ...lines.slice(start, last).map((text) => ({
          type: "paragraph",
          ...(text && { content: [{ type: "text", text }] }),
        })),
        ...paragraphs.slice(end),
      ],
    },
  };
}

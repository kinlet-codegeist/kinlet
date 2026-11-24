import {
  applyPassage,
  editablePassages,
  newParagraph,
  type Passage,
} from "../domain/ticket-draft";
import { plainText, type AdfNode } from "./atlassian-text";

export type PassageEdit = {
  original: string;
  replacement: string;
  reason: string;
};
export const maxReturnedChanges = 10;
export const maxReviewReason = 600;

export function parsePassage(value: unknown): PassageEdit {
  const change = value as Partial<PassageEdit> | null;
  if (
    typeof change?.original !== "string" ||
    typeof change.replacement !== "string" ||
    (change.reason !== undefined && typeof change.reason !== "string")
  )
    throw new Error(
      "Each proposed edit needs original wording and replacement wording.",
    );
  const original = change.original.replace(/\r\n?/g, "\n");
  const replacement = change.replacement.replace(/\r\n?/g, "\n");
  if (original === replacement || (!original && !replacement.trim()))
    throw new Error(
      "Enter a change in each proposed edit before reviewing it.",
    );
  return { original, replacement, reason: change.reason?.trim() ?? "" };
}

type Target = { passage: Passage; order: number; start: number; end: number };
type Choice = { change: PassageEdit; target?: Target; problem?: string };

export function locateReturnedChanges(
  doc: AdfNode | null,
  changes: PassageEdit[],
  checkForDuplicates: boolean,
): Choice[] {
  const text = plainText(doc);
  const passages = editablePassages(doc);
  return changes.map((change) => {
    if (!change.original) {
      const present = text.includes(change.replacement.trim());
      return {
        change,
        problem:
          present && checkForDuplicates
            ? "This wording already appears in the current description."
            : undefined,
      };
    }
    const first = text.indexOf(change.original);
    if (first < 0 || text.indexOf(change.original, first + 1) !== -1)
      return {
        change,
        problem:
          "The original wording must appear exactly once in the current description.",
      };
    const order = passages.findIndex((p) => p.text.includes(change.original));
    if (order === -1)
      return {
        change,
        problem: "The original wording spans formatting or protected content.",
      };
    const passage = passages[order];
    const start = passage.text.indexOf(change.original);
    if (
      checkForDuplicates &&
      change.replacement &&
      passage.text.includes(change.replacement) &&
      change.replacement.includes(change.original)
    )
      return {
        change,
        problem: "This wording already appears in the current passage.",
      };
    return {
      change,
      target: { passage, order, start, end: start + change.original.length },
    };
  });
}

export function composeReturnedChanges(
  doc: AdfNode | null,
  choices: Choice[],
  indexes: number[],
) {
  let expected = doc;
  const byPassage = new Map<number, Array<Target & { replacement: string }>>();
  const append = new Set<string>();
  for (const i of [...new Set(indexes)].sort((a, b) => a - b)) {
    const choice = choices[i];
    if (!choice || choice.problem)
      throw new Error(choice?.problem ?? "Choose an available edit.");
    if (choice.target) {
      const group = byPassage.get(choice.target.order) ?? [];
      group.push({ ...choice.target, replacement: choice.change.replacement });
      byPassage.set(choice.target.order, group);
    } else {
      const wording = choice.change.replacement;
      if ([...append].some((previous) => previous.trim() === wording.trim()))
        throw new Error("Select just one copy of the repeated addition.");
      append.add(wording);
    }
  }

  // Edit the original text ranges, working backwards so earlier paths stay valid.
  for (const order of [...byPassage.keys()].sort((a, b) => b - a)) {
    const group = byPassage.get(order)!.sort((a, b) => b.start - a.start);
    const { passage } = group[0];
    let wording = passage.text;
    let boundary = wording.length;
    for (const { start, end, replacement } of group) {
      if (end > boundary)
        throw new Error(
          "These edits overlap. Select just one of the overlapping edits.",
        );
      wording = wording.slice(0, start) + replacement + wording.slice(end);
      boundary = start;
    }
    expected = applyPassage(expected, passage, wording);
  }
  for (const wording of append)
    expected = applyPassage(expected, newParagraph, wording);
  return expected && plainText(expected) !== plainText(doc) ? expected : null;
}

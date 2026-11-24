import { sentences, type WordingChange } from "./plan-diff";
import { similarity, type SentenceEncoder } from "./sentence-encoder";

import { newParagraph, type Passage } from "./editable-passages";
export {
  applyPassage,
  editablePassages,
  newParagraph,
  textDocument,
  type Passage,
} from "./editable-passages";

type Match = { passage: Passage; start: number; end: number; score: number };
// Rank one ticket sentence against a removed requirement; the replacement is quoted from the published plan.
export function matchPassage(
  passages: Passage[],
  change: WordingChange,
  encode?: SentenceEncoder,
): Match | undefined {
  if (!change.before.length) return;
  const oldText = change.before.join(" ");
  for (const passage of passages) {
    const start = passage.text.indexOf(oldText);
    if (start >= 0)
      return { passage, start, end: start + oldText.length, score: 1 };
  }
  if (!encode) return;
  const source = encode(oldText);
  let best: Match | undefined;
  for (const passage of passages) {
    let from = 0;
    for (const sentence of sentences(passage.text)) {
      const start = passage.text.indexOf(sentence, from);
      if (start < 0) continue;
      from = start + sentence.length;
      const score = similarity(source, encode(sentence));
      if (!best || score > best.score)
        best = { passage, start, end: from, score };
    }
  }
  return best && best.score >= 0.58 ? best : undefined;
}

export function suggestWording(
  passage: Passage,
  change: WordingChange,
  match?: Match,
): string {
  const replacement = change.after.join(" ");
  if (passage.id === newParagraph.id) return replacement;
  if (
    !change.before.length &&
    replacement &&
    !passage.text.includes(replacement)
  )
    return passage.text.trimEnd() + " " + replacement;
  if (!match || match.passage.id !== passage.id) return passage.text;
  const before = passage.text.slice(0, match.start);
  const after = passage.text.slice(match.end);
  if (replacement) return before + replacement + after;
  // Remove only the selected sentence and the redundant adjoining space.
  return before
    ? before + after.replace(/^\s+/, "")
    : after.replace(/^\s+/, "");
}

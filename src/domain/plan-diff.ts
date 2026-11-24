export type WordingChange = { before: string[]; after: string[] };
export type WordingDiff = { groups: WordingChange[]; fullText: boolean };

export function sentences(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (typeof Intl.Segmenter !== "function")
    return lines.map((line) => line.trim()).filter(Boolean);
  const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  return lines
    .flatMap((line) =>
      Array.from(segmenter.segment(line), (part) => part.segment.trim()),
    )
    .filter(Boolean);
}

export function compareWording(saved: string, current: string): WordingDiff {
  if (saved === current) return { groups: [], fullText: false };
  const before = sentences(saved);
  const after = sentences(current);
  let start = 0;
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    start < endBefore &&
    start < endAfter &&
    before[start] === after[start]
  )
    start++;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore--;
    endAfter--;
  }
  const left = before.slice(start, endBefore);
  const right = after.slice(start, endAfter);
  if (!left.length && !right.length) return { groups: [], fullText: false };
  // Bound the cost of comparing long documents. The UI offers both originals for these cases.
  const width = right.length + 1;
  if ((left.length + 1) * width > 1_000_000)
    return { groups: [], fullText: true };
  const lengths = new Uint32Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      const cell = i * width + j;
      lengths[cell] =
        left[i] === right[j]
          ? 1 + lengths[cell + width + 1]
          : Math.max(lengths[cell + width], lengths[cell + 1]);
    }
  }
  const groups: WordingChange[] = [];
  let group: WordingChange | undefined;
  let i = 0,
    j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      group = undefined;
      i++;
      j++;
      continue;
    }
    if (!group) {
      group = { before: [], after: [] };
      groups.push(group);
    }
    const cell = i * width + j;
    if (
      i < left.length &&
      (j === right.length || lengths[cell + width] >= lengths[cell + 1])
    )
      group.before.push(left[i++]);
    else group.after.push(right[j++]);
  }
  return { groups, fullText: false };
}

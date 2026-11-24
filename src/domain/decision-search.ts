import type { DecisionEntry } from "../platform/review-decisions";

const stopWords = new Set(
  "a an and are as at be because by can could decision decisions did do does for from had has have how i in is it its me of on or our plan please reason reasons review reviews show than that the their then there this to was we were what when which who why with would".split(
    " ",
  ),
);
export const decisionLabels = {
  kept: "Kept the ticket as written",
  updated: "Accepted updated ticket wording",
};

function normalize(text: string) {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\b(?:sign(?:ing)?[ -]?in|log(?:ging)?[ -]?in)\b/g, "signin");
}

function words(text: string) {
  const tokens = normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(
    tokens
      .filter((token) => !stopWords.has(token))
      .map((token) => {
        if (token === "kept") return "keep";
        if (token === "accepted") return "accept";
        if (token === "updated") return "update";
        return token;
      }),
  );
}

export function parseDecisionSearch(text: string) {
  const keys = new Set<string>();
  const versions = new Set<number>();
  const topic = normalize(text)
    .replace(/\b[a-z][a-z0-9_]*-\d+\b/g, (key) => {
      keys.add(key.toUpperCase());
      return " ";
    })
    .replace(/\b(?:v|version\s+)\s*(\d+)\b/g, (_, version) => {
      versions.add(Number(version));
      return " ";
    });
  return { keys, versions, terms: words(topic) };
}
export type DecisionQuery = ReturnType<typeof parseDecisionSearch>;
export type DecisionHit = {
  key: string;
  entry: DecisionEntry;
  score: number;
  wordingMatched: boolean;
};

export function matchDecisions(
  key: string,
  entries: DecisionEntry[],
  query: DecisionQuery,
): DecisionHit[] {
  if (query.keys.size && !query.keys.has(key)) return [];
  const hits: DecisionHit[] = [];
  for (const entry of entries) {
    if (query.versions.size && !query.versions.has(entry.version)) continue;
    const decision = entry.decision;
    const reason = words(decision?.reason ?? "");
    const metadata = words(
      entry.author +
        " " +
        (decision ? decisionLabels[decision.outcome] : "Marked reviewed"),
    );
    // Large ticket descriptions are only tokenized if a query term needs the saved wording.
    let wording: Set<string> | undefined;
    let score = 0;
    let wordingMatched = false;
    const matches = Array.from(query.terms).every((term) => {
      if (reason.has(term)) {
        score += 5;
        return true;
      }
      if (metadata.has(term)) {
        score += 2;
        return true;
      }
      if (!decision) return false;
      wording ??= words(
        decision.wording.summary + " " + decision.wording.description,
      );
      if (!wording.has(term)) return false;
      wordingMatched = true;
      score += 1;
      return true;
    });
    if (matches) hits.push({ key, entry, score, wordingMatched });
  }
  return hits;
}

export function sortDecisionHits(hits: DecisionHit[]) {
  return hits.sort(
    (a, b) =>
      b.score - a.score ||
      Date.parse(b.entry.created) - Date.parse(a.entry.created) ||
      a.key.localeCompare(b.key, undefined, { numeric: true }) ||
      b.entry.id.localeCompare(a.entry.id, undefined, { numeric: true }),
  );
}

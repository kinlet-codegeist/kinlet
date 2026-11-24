import { sentences } from "./plan-diff";
import type { SourceRef } from "./workspace";

export const decisionLimits = { tickets: 5, candidates: 10, wording: 600 };

export type DecisionSource = {
  source: SourceRef;
  key: string;
  title: string;
  version: string;
  text: string;
};

export type DecisionSources = {
  plan: DecisionSource;
  tickets: DecisionSource[];
  omitted: number;
  signature: string;
};

export type DecisionOption = { name: string; wording: string };
export type DecisionFinding = {
  key: string;
  title: string;
  status: "update" | "matches" | "keep" | "confirm";
  quote?: string;
  followUp: string;
};

export type DecisionFollowUps = {
  plan: { id: string; title: string; version: string };
  original: string;
  option: DecisionOption;
  findings: DecisionFinding[];
  unavailable: number;
};

const stripListMarker = (text: string) =>
  text.replace(/^(?:[•*–-]|\d+\.)\s+/u, "");
const comparable = (text: string) =>
  stripListMarker(text.normalize("NFKC").trim())
    .toLowerCase()
    .replace(/\s+/g, " ");

export function decisionPassages(text: string) {
  const passages = sentences(text)
    .map(stripListMarker)
    .filter(
      (passage) =>
        passage.length <= decisionLimits.wording && /\p{L}/u.test(passage),
    );
  return [...new Set(passages)].filter((passage) => {
    const index = text.indexOf(passage);
    return index >= 0 && index === text.lastIndexOf(passage);
  });
}

export function analyzeDecision(
  plan: DecisionSource,
  original: string,
  option: DecisionOption,
  tickets: DecisionSource[],
): DecisionFinding[] {
  const prior = comparable(original);
  const proposed = new Set(sentences(option.wording).map(comparable));
  const retained = new Set(
    sentences(plan.text)
      .map(comparable)
      .filter((line) => line !== prior),
  );
  return tickets.map(({ key, title, text }) => {
    const evidence = sentences(text);
    const oldQuote = evidence.find((line) => comparable(line) === prior);
    if (oldQuote && !proposed.has(prior))
      return {
        key,
        title,
        status: "update",
        quote: oldQuote,
        followUp: "Update the ticket wording to reflect this option.",
      };
    const newQuote = evidence.find((line) => proposed.has(comparable(line)));
    if (newQuote)
      return {
        key,
        title,
        status: "matches",
        quote: newQuote,
        followUp: "Keep the quoted wording. It already appears in this option.",
      };
    const retainedQuote = evidence.find((line) =>
      retained.has(comparable(line)),
    );
    if (retainedQuote)
      return {
        key,
        title,
        status: "keep",
        quote: retainedQuote,
        followUp: "Keep this check from the unchanged part of the plan.",
      };
    return {
      key,
      title,
      status: "confirm",
      followUp:
        "Confirm whether this option changes the ticket’s requirements.",
    };
  });
}

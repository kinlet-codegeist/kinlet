import {
  reviewFields,
  requireSource,
  sourceKey,
  type Checkpoint,
  type Citation,
  type CitationReview,
  type DraftChange,
  type Observation,
  type ReviewField,
  type SourceRef,
  type SourceVersion,
} from "../domain/workspace";
import { sentences } from "../domain/plan-diff";
import { plainText } from "../platform/atlassian-text";
import type { Actor } from "./workspace-resolver";
import {
  canReadSource,
  captureSource,
  fitsWorkspace,
} from "./workspace-sources";

const normalize = (text: string) =>
  text.normalize("NFC").trim().replace(/\s+/gu, " ");
const citationLimit = 3;
const maxQuote = 600;

function occurrences(source: SourceVersion, quote: string) {
  const wanted = normalize(quote);
  // Match complete sentences or paragraphs so adding a condition to a sentence changes its evidence.
  const passages = sentences(plainText(source.body)).map(normalize);
  return (
    passages.filter((passage) => passage === wanted).length +
    Number(normalize(source.title) === wanted)
  );
}

export function citationsOf(change: DraftChange) {
  return Object.values(change.citations ?? {}).flatMap((items) => items ?? []);
}

export function sourceAccess(actor: Actor) {
  const reads = new Map<string, Promise<boolean>>();
  return (source: SourceRef) => {
    const key = sourceKey(source);
    if (!reads.has(key))
      reads.set(key, canReadSource(actor.client, actor.project, source));
    return reads.get(key)!;
  };
}

export async function canSeeDraft(
  change: DraftChange,
  read: (source: SourceRef) => Promise<boolean>,
) {
  return (
    await Promise.all(
      [change.source, ...citationsOf(change).map(({ source }) => source)].map(
        read,
      ),
    )
  ).every(Boolean);
}

export function currentSources(actor: Actor) {
  const reads = new Map<string, Promise<SourceVersion | undefined>>();
  const lanes = Array.from({ length: 4 }, () => Promise.resolve());
  return (source: SourceRef) => {
    const key = sourceKey(source);
    if (!reads.has(key)) {
      const lane = reads.size % lanes.length;
      const fetch = lanes[lane]
        .then(() => captureSource(actor.client, actor.project, source))
        .then(
          (version) => (fitsWorkspace(version) ? version : undefined),
          () => undefined,
        );
      reads.set(key, fetch);
      lanes[lane] = fetch.then(() => {});
    }
    return reads.get(key)!;
  };
}

export async function checkCitations(
  citations: Citation[],
  read: ReturnType<typeof currentSources>,
): Promise<CitationReview[]> {
  return Promise.all(
    citations.map(async (citation) => {
      const live = await read(citation.source);
      if (!live) return { status: "unavailable", required: citation.required };
      const matches = occurrences(live, citation.quote);
      return {
        status: matches === 1 ? "current" : matches ? "ambiguous" : "changed",
        required: citation.required,
        source: citation.source,
        label: live.title,
        quote: citation.quote,
        savedVersion: citation.version,
        version: live.version,
      };
    }),
  );
}

export async function validateDraftEvidence(
  change: DraftChange,
  raw: Partial<DraftChange>,
  base: Checkpoint,
  read: (base: Checkpoint, source: SourceRef) => Promise<Observation>,
) {
  const values = {
    title: change.title,
    body: change.body,
    priority: change.priorityId,
  };
  const saved = new Map<string, Promise<Observation>>();
  const citations: NonNullable<DraftChange["citations"]> = {};
  if (raw.citations !== undefined) {
    if (
      !raw.citations ||
      typeof raw.citations !== "object" ||
      Array.isArray(raw.citations) ||
      Object.keys(raw.citations).some(
        (field) => !reviewFields.includes(field as ReviewField),
      )
    )
      throw new Error("Choose evidence for a supported draft field.");
    for (const field of reviewFields) {
      const items = raw.citations[field];
      if (items === undefined) continue;
      if (
        !Array.isArray(items) ||
        items.length > citationLimit ||
        values[field] === undefined
      )
        throw new Error(
          "Attach evidence to a changed field, with up to three citations.",
        );
      if (!items.length) continue;
      citations[field] = await Promise.all(
        items.map(async (item) => {
          if (
            !item ||
            typeof item.quote !== "string" ||
            !item.quote.trim() ||
            item.quote.length > maxQuote ||
            typeof item.required !== "boolean"
          )
            throw new Error(
              "Select a saved sentence or title of up to 600 characters.",
            );
          const source = requireSource(item.source);
          const key = sourceKey(source);
          if (!saved.has(key)) saved.set(key, read(base, source));
          const entry = await saved.get(key)!;
          if (
            entry.status !== "captured" ||
            occurrences(entry.version, item.quote) !== 1
          )
            throw new Error(
              "The cited wording must appear once in a readable checkpoint source.",
            );
          return {
            source,
            quote: item.quote.trim(),
            required: item.required,
            version: entry.version.version,
          };
        }),
      );
      if (
        new Set(
          citations[field].map((citation) =>
            JSON.stringify([
              sourceKey(citation.source),
              normalize(citation.quote),
            ]),
          ),
        ).size !== items.length
      )
        throw new Error("Choose distinct pieces of evidence for this field.");
    }
  }
  if (
    raw.disputed !== undefined &&
    (!Array.isArray(raw.disputed) ||
      raw.disputed.some(
        (field) =>
          !reviewFields.includes(field) || (citations[field]?.length ?? 0) < 2,
      ))
  )
    throw new Error("Choose two citations before flagging a disagreement.");
  if (Object.keys(citations).length) change.citations = citations;
  if (raw.disputed?.length) change.disputed = [...new Set(raw.disputed)];
  return change;
}

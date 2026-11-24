import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  matchDecisions,
  parseDecisionSearch,
  sortDecisionHits,
} from "../domain/decision-search";
import {
  searchProjectDecisions,
  type DecisionResults,
} from "../platform/project-decisions";
import type { SampleHandoffSource } from "../platform/decision-handoff";
import type { DecisionEntry } from "../platform/review-decisions";
import { DecisionRow } from "./ReviewDecision";
import { Button } from "./ui";

type Sample = SampleHandoffSource & { entries: DecisionEntry[] };

export function DecisionSearch({
  sample,
  recentlyReviewedIssue,
  initialText = "",
  onSubmitted,
}: {
  sample?: Sample;
  recentlyReviewedIssue?: string;
  initialText?: string;
  onSubmitted?: (text: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState(initialText);
  const [results, setResults] = useState<DecisionResults>();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [limit, setLimit] = useState(10);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function search(event: FormEvent) {
    event.preventDefault();
    pending.current?.abort();
    setResults(undefined);
    setLimit(10);
    const query = parseDecisionSearch(text);
    if (!query.terms.size && !query.keys.size && !query.versions.size) {
      setHint(
        "Include a topic, reviewer, ticket key, or reviewed plan version.",
      );
      setBusy(false);
      return;
    }
    setHint("");
    onSubmitted?.(text);
    if (sample) {
      setResults({
        hits: sortDecisionHits(
          matchDecisions(sample.key, sample.entries, query),
        ),
        unreadable: 0,
      });
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const found = await searchProjectDecisions(
        query,
        controller.signal,
        recentlyReviewedIssue,
      );
      if (!controller.signal.aborted) setResults(found);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="decision-search">
      <form onSubmit={search} role="search" aria-label="Search saved reviews">
        <label htmlFor={id}>
          {sample
            ? "Search this sample ticket’s decisions"
            : "Search this project’s decisions"}
        </label>
        <div className="decision-search-input">
          <input
            id={id}
            type="search"
            maxLength={240}
            value={text}
            placeholder={
              sample
                ? "Why did we keep sign-in?"
                : "Topic, reviewer, ticket key, or plan version"
            }
            onChange={(event) => {
              pending.current?.abort();
              setText(event.target.value);
              setResults(undefined);
              setHint("");
              setBusy(false);
            }}
          />
          <Button
            variant="primary"
            type="submit"
            disabled={!text.trim() || busy}
          >
            Search
          </Button>
        </div>
      </form>
      {hint && <p role="status">{hint}</p>}
      {busy && <p role="status">Searching saved Jira reviews…</p>}
      {results && (
        <>
          <p role="status">
            {results.hits.length
              ? results.hits.length +
                (results.hits.length === 1
                  ? " matching review."
                  : " matching reviews.")
              : results.error || results.unreadable
                ? "No matches in the records that could be checked."
                : "No saved reviews match this search."}
          </p>
          {results.error && (
            <p role="alert">Search incomplete. {results.error}</p>
          )}
          {results.unreadable > 0 && (
            <p role="status">
              Search incomplete.{" "}
              {results.unreadable === 1
                ? "One review record could not be read."
                : results.unreadable + " review records could not be read."}
            </p>
          )}
          {results.hits.length > 0 && (
            <div className="ticket-decisions decision-results">
              <ol>
                {results.hits
                  .slice(0, limit)
                  .map(({ key, entry, wordingMatched }) => (
                    <DecisionRow
                      key={key + "/" + entry.id}
                      entry={entry}
                      pageLabel={sample?.plan.title}
                      handoffSource={sample ?? { kind: "jira", key }}
                      wordingMatched={wordingMatched}
                      source={
                        sample ? (
                          key
                        ) : (
                          <Link
                            className="text-link"
                            aria-label={
                              "Open " + key + " decision for v" + entry.version
                            }
                            to={
                              "/jira?" +
                              new URLSearchParams({
                                ticket: key,
                                review: entry.id,
                              })
                            }
                          >
                            {key} · Open decision
                          </Link>
                        )
                      }
                    />
                  ))}
              </ol>
              {limit < results.hits.length && (
                <Button
                  size="small"
                  onClick={() => setLimit((current) => current + 10)}
                >
                  Show more reviews
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

import {
  matchDecisions,
  sortDecisionHits,
  type DecisionHit,
  type DecisionQuery,
} from "../domain/decision-search";
import {
  projectAttachmentTickets,
  readTicket,
  type IndexedTicket,
} from "./jira-checkpoints";
import { ticketDecisions } from "./review-decisions";

export type DecisionResults = {
  hits: DecisionHit[];
  unreadable: number;
  error?: string;
};

export async function searchProjectDecisions(
  query: DecisionQuery,
  signal: AbortSignal,
  recentlyReviewedIssue?: string,
): Promise<DecisionResults> {
  const result: DecisionResults = { hits: [], unreadable: 0 };
  async function inspect(ticket: IndexedTicket) {
    const history = await ticketDecisions(ticket, signal, query.versions);
    result.unreadable += history.unavailable;
    for (const hit of matchDecisions(ticket.key, history.entries, query))
      result.hits.push(hit);
  }
  try {
    if (query.keys.size) {
      const failures: string[] = [];
      for (const key of query.keys) {
        if (signal.aborted) return result;
        try {
          await inspect(await readTicket(key));
        } catch (error) {
          failures.push(
            key +
              " — " +
              (error instanceof Error
                ? error.message
                : "Couldn’t read this ticket."),
          );
        }
      }
      if (failures.length) result.error = failures.join(" ");
    } else {
      const seen = new Set<string>();
      for await (const tickets of projectAttachmentTickets(
        signal,
        recentlyReviewedIssue,
      )) {
        for (const ticket of tickets) {
          if (signal.aborted) return result;
          if (!ticket.reviews.length || seen.has(ticket.id)) continue;
          seen.add(ticket.id);
          await inspect(ticket);
        }
      }
    }
  } catch (error) {
    result.error =
      error instanceof Error
        ? error.message
        : "Jira couldn’t finish the search.";
  }
  sortDecisionHits(result.hits);
  return result;
}

import { useState } from "react";
import { readTicketGoals } from "../platform/teamwork-goals";
import { Button } from "./ui";

export function LinkedGoals({
  issueId,
  cloudId,
}: {
  issueId: string;
  cloudId: string;
}) {
  const [result, setResult] =
    useState<Awaited<ReturnType<typeof readTicketGoals>>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function load() {
    setResult(undefined);
    setBusy(true);
    setError(false);
    try {
      setResult(await readTicketGoals(cloudId, issueId));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="linked-goals" aria-label="Linked goals">
      <div className="live-heading">
        <h3>Linked goals</h3>
        <Button size="small" disabled={busy} onClick={() => void load()}>
          {result ? "Refresh goals" : "Check linked goals"}
        </Button>
      </div>
      {busy && <p role="status">Checking Teamwork Graph…</p>}
      {error && (
        <p role="alert">
          Couldn’t load goals from Teamwork Graph. Check the site’s Graph access
          and try again.
        </p>
      )}
      {result?.goals.length ? (
        <ul>
          {result.goals.map((goal) => (
            <li key={goal.id}>
              {goal.url ? (
                <a
                  className="text-link"
                  href={goal.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {goal.name}
                </a>
              ) : (
                goal.name
              )}
            </li>
          ))}
        </ul>
      ) : (
        result && (
          <p role="status">
            Teamwork Graph returned no visible goals for this ticket.
          </p>
        )
      )}
      {result?.hasMore && <p>Showing the first 10 linked goals.</p>}
    </section>
  );
}

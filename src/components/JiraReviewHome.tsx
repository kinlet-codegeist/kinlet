import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CirclePause,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  parseTicketReference,
  recentTickets,
} from "../platform/jira-checkpoints";
import { runtime } from "../platform/runtime";
import { NeedsReview } from "./NeedsReview";
import { Button } from "./ui";

export function JiraReviewHome({
  onReviewSaved,
}: {
  onReviewSaved: (id: string) => void;
}) {
  return (
    <div className="kinlet-home">
      <header className="kinlet-home-heading">
        <h1>Project overview</h1>
        <p>Open a task, review plans, or save a project checkpoint.</p>
      </header>
      {runtime.connected && (
        <>
          <div className="kinlet-home-grid">
            <JiraTaskPicker />
            <NeedsReview onReviewSaved={onReviewSaved} />
          </div>
          <JiraReviewTools />
        </>
      )}
      <details className="card padded-card kinlet-review-tools">
        <summary>Help and tutorials</summary>
        <section
          className="kinlet-start-practice"
          aria-labelledby="kinlet-practice-title"
        >
          <div className="kinlet-practice-intro">
            <h2 id="kinlet-practice-title">Try a practice review</h2>
            <p>
              An online store changes its checkout rule. Review two suggested
              edits and choose what to keep.
            </p>
            <div className="kinlet-home-actions">
              <Link
                className="button button-primary button-normal"
                to={
                  runtime.connected
                    ? "/jira?view=practice"
                    : "/jira?example=checkout"
                }
              >
                {runtime.connected
                  ? "Start practice review"
                  : "Open the practice example"}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              {runtime.connected && (
                <Link className="text-link" to="/jira?example=checkout">
                  Preview without creating tasks
                </Link>
              )}
            </div>
          </div>
          <div className="kinlet-practice-example">
            <p>The store now lets shoppers pay as guests.</p>
            <ul>
              <li>
                <CirclePause
                  size={18}
                  className="kinlet-practice-hold"
                  aria-hidden="true"
                />
                <span>Require shoppers to sign in</span>
                <strong>On hold</strong>
              </li>
              <li>
                <CheckCircle2
                  size={18}
                  className="kinlet-practice-keep"
                  aria-hidden="true"
                />
                <span>Retry payment on the same order</span>
                <strong>Still applies</strong>
              </li>
            </ul>
          </div>
        </section>
        <Link className="text-link" to="/attention">
          Open sample workspace
        </Link>
      </details>
    </div>
  );
}

function JiraTaskPicker() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [recent, setRecent] =
    useState<Awaited<ReturnType<typeof recentTickets>>>();
  const [listError, setListError] = useState(false);
  useEffect(() => {
    let current = true;
    recentTickets().then(
      (tickets) => {
        if (current) setRecent(tickets);
      },
      () => {
        if (current) setListError(true);
      },
    );
    return () => {
      current = false;
    };
  }, [attempt]);
  const example = runtime.projectKey + "-1";

  return (
    <section
      className="card padded-card kinlet-home-card"
      aria-labelledby="open-task-title"
    >
      <h2 id="open-task-title">Open a Jira task</h2>
      {listError ? (
        <p>
          Couldn’t load recent tasks.{" "}
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              setListError(false);
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </p>
      ) : !recent ? (
        <p role="status" className="muted">
          Loading tasks…
        </p>
      ) : recent.length ? (
        <ul className="kinlet-task-list" aria-label="Recently updated tasks">
          {recent.map((task) => (
            <li key={task.key}>
              <Link to={"/jira?ticket=" + encodeURIComponent(task.key)}>
                <span>
                  <strong>{task.fields.summary}</strong>
                  <small>{task.key}</small>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No Jira tasks are visible in this project yet.</p>
      )}
      <details className="kinlet-task-lookup">
        <summary>Find a task by ID or link</summary>
        <form
          className="live-ticket-form"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const key = parseTicketReference(input);
              navigate("/jira?ticket=" + encodeURIComponent(key));
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "Enter a Jira task ID or link.",
              );
            }
          }}
        >
          <label htmlFor="jira-task-reference">Task ID or Jira link</label>
          <p id="jira-task-help" className="muted">
            Jira puts an ID like {example} next to the task’s title. You can
            paste that ID or the link you use to open the task.
          </p>
          <div>
            <input
              id="jira-task-reference"
              aria-describedby={
                error ? "jira-task-help jira-task-error" : "jira-task-help"
              }
              aria-invalid={!!error}
              placeholder={example}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setError("");
              }}
              autoComplete="off"
              required
            />
            <Button type="submit" disabled={!input.trim()}>
              View in Kinlet
            </Button>
          </div>
          {error && (
            <p role="alert" id="jira-task-error" className="live-error">
              {error}
            </p>
          )}
        </form>
      </details>
    </section>
  );
}

export function JiraReviewTools({ ticketKey }: { ticketKey?: string }) {
  const tools = [
    {
      view: "attention",
      label: "Review priorities",
      detail: "See what needs your attention first.",
    },
    {
      view: "workspace",
      label: "Project workspace",
      detail: "Save the state of several tasks and plans together.",
    },
    {
      view: "compare-decision",
      label: "Compare two plans",
      detail: "See which tasks each option could affect.",
    },
    {
      view: "branches",
      label: "Drafts to review",
      detail: "See suggested edits waiting for a decision.",
    },
    {
      view: "decisions",
      label: "Find a past decision",
      detail: "Look up why an earlier change was approved or set aside.",
    },
  ];
  return (
    <details className="card padded-card kinlet-review-tools">
      <summary>More review tools</summary>
      <ul>
        {tools.map(({ view, label, detail }) => (
          <li key={view}>
            <Link
              to={
                "/jira?view=" +
                view +
                (view === "compare-decision" && ticketKey
                  ? "&anchor=" + encodeURIComponent(ticketKey)
                  : "")
              }
            >
              <strong>{label}</strong>
              <span>{detail}</span>
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

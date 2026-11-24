import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { DecisionFindings } from "../components/DecisionFindings";
import { Button, Notice, PageTitle } from "../components/ui";
import {
  analyzeDecision,
  decisionLimits,
  decisionPassages,
  type DecisionOption,
  type DecisionSources,
} from "../domain/decision-impact";
import type { Branch } from "../domain/workspace";
import { parsePageId } from "../platform/confluence-plan";
import { runtime } from "../platform/runtime";
import { workspaceRequest } from "../platform/workspace";

type Loaded = {
  target: { anchorKey: string; planId: string };
  sources: DecisionSources;
};
type Comparison = {
  original: string;
  options: [DecisionOption, DecisionOption];
};
const emptyOption: DecisionOption = { name: "", wording: "" };
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Kinlet couldn’t complete the request. Try again.";

export function DecisionImpact({ initialTicket }: { initialTicket: string }) {
  const [anchor, setAnchor] = useState(initialTicket);
  const [page, setPage] = useState("");
  const [loaded, setLoaded] = useState<Loaded>();
  const [original, setOriginal] = useState("");
  const [first, setFirst] = useState(emptyOption);
  const [second, setSecond] = useState(emptyOption);
  const [comparison, setComparison] = useState<Comparison>();
  const [branches, setBranches] = useState<Branch[]>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const requestId = useRef("");
  const passages = useMemo(
    () => decisionPassages(loaded?.sources.plan.text ?? ""),
    [loaded],
  );

  async function loadSources(event: FormEvent) {
    event.preventDefault();
    setBusy("Loading Jira links and the Confluence plan…");
    setError("");
    setLoaded(undefined);
    setComparison(undefined);
    setBranches(undefined);
    try {
      const target = {
        anchorKey: anchor.trim().toUpperCase(),
        planId: parsePageId(page),
      };
      const sources = await workspaceRequest<DecisionSources>(
        "decisionSources",
        target,
      );
      setOriginal("");
      setLoaded({ target, sources });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy("");
    }
  }

  function compare(event: FormEvent) {
    event.preventDefault();
    setError("");
    const options: Comparison["options"] = [
      { name: first.name.trim(), wording: first.wording.trim() },
      { name: second.name.trim(), wording: second.wording.trim() },
    ];
    if (
      !original ||
      options.some(({ name, wording }) => !name || !wording) ||
      options[0].name.toLowerCase() === options[1].name.toLowerCase() ||
      new Set(
        [original, ...options.map(({ wording }) => wording)].map((wording) =>
          wording.toLowerCase(),
        ),
      ).size !== 3
    ) {
      setError(
        "Choose current wording and enter two alternatives with different names and wording.",
      );
      return;
    }
    requestId.current = crypto.randomUUID();
    setBranches(undefined);
    setComparison({ original, options });
  }

  async function saveBranches() {
    if (!loaded || !comparison || branches) return;
    setBusy("Saving the two branches…");
    setError("");
    try {
      setBranches(
        await workspaceRequest<Branch[]>("saveDecisionBranches", {
          ...loaded.target,
          signature: loaded.sources.signature,
          requestId: requestId.current,
          original: comparison.original,
          first: comparison.options[0],
          second: comparison.options[1],
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <PageTitle
        title="Compare decision options"
        description="Try two ways to change a Confluence plan and see which linked Jira tickets may need follow-up."
        actions={
          <Link className="text-link" to="/jira?view=workspace">
            Project workspace
          </Link>
        }
      />
      <section className="card padded-card workspace-card">
        <form
          className="workspace-form"
          onSubmit={(event) => void loadSources(event)}
        >
          <div className="decision-columns">
            <label>
              Starting Jira ticket
              <input
                required
                maxLength={44}
                value={anchor}
                placeholder={runtime.projectKey + "-1"}
                onChange={(event) => {
                  setAnchor(event.target.value);
                  setLoaded(undefined);
                }}
                disabled={!!busy}
              />
            </label>
            <label>
              Confluence plan URL or page ID
              <input
                required
                value={page}
                onChange={(event) => {
                  setPage(event.target.value);
                  setLoaded(undefined);
                }}
                disabled={!!busy}
              />
            </label>
          </div>
          <p className="muted">
            Kinlet checks up to five tickets directly linked to the starting
            ticket in this project.
          </p>
          <Button
            type="submit"
            disabled={!!busy || !anchor.trim() || !page.trim()}
          >
            Load sources
          </Button>
        </form>
      </section>
      {loaded && (
        <section className="card padded-card workspace-card">
          <div className="live-heading">
            <h2>{loaded.sources.plan.title}</h2>
            <small>
              Confluence v{loaded.sources.plan.version} ·{" "}
              {loaded.sources.tickets.length} linked tickets
            </small>
          </div>
          {!!loaded.sources.omitted && (
            <Notice>
              {loaded.sources.omitted} linked{" "}
              {loaded.sources.omitted === 1 ? "ticket is" : "tickets are"}{" "}
              outside this comparison.
            </Notice>
          )}
          {passages.length ? (
            <form className="workspace-form" onSubmit={compare}>
              <label>
                Current plan wording
                <select
                  required
                  value={original}
                  disabled={!!busy}
                  onChange={(event) => {
                    setOriginal(event.target.value);
                    setComparison(undefined);
                  }}
                >
                  <option value="">Choose the wording to replace</option>
                  {passages.map((passage) => (
                    <option key={passage} value={passage}>
                      {passage}
                    </option>
                  ))}
                </select>
              </label>
              <div className="decision-columns">
                <OptionFields
                  label="Option A"
                  option={first}
                  disabled={!!busy}
                  onChange={(option) => {
                    setFirst(option);
                    setComparison(undefined);
                  }}
                />
                <OptionFields
                  label="Option B"
                  option={second}
                  disabled={!!busy}
                  onChange={(option) => {
                    setSecond(option);
                    setComparison(undefined);
                  }}
                />
              </div>
              <Button
                variant="primary"
                type="submit"
                disabled={!!busy || !original}
              >
                Compare options
              </Button>
            </form>
          ) : (
            <Notice>
              Use a plan with a unique sentence or short paragraph to replace.
            </Notice>
          )}
        </section>
      )}
      {loaded && comparison && (
        <section className="card padded-card workspace-card">
          <h2>Impact on linked tickets</h2>
          <div>
            <strong>
              Current plan · Confluence v{loaded.sources.plan.version}
            </strong>
            <blockquote className="decision-quote">
              {comparison.original}
            </blockquote>
          </div>
          <p className="muted">
            Kinlet looks for matching wording. Confirm any ticket without a
            match before relying on the result.
          </p>
          <div className="decision-columns">
            {comparison.options.map((option, index) => (
              <article className="decision-option" key={option.name}>
                <h3>{option.name}</h3>
                <blockquote className="decision-quote">
                  {option.wording}
                </blockquote>
                <DecisionFindings
                  findings={analyzeDecision(
                    loaded.sources.plan,
                    comparison.original,
                    option,
                    loaded.sources.tickets,
                  )}
                />
                {branches?.[index] && (
                  <Link
                    className="button button-secondary button-normal"
                    to={
                      "/jira?view=workspace&record=branch&id=" +
                      branches[index].id
                    }
                  >
                    Open {option.name} branch
                  </Link>
                )}
              </article>
            ))}
          </div>
          {branches ? (
            <p role="status">Both branches saved from the same checkpoint.</p>
          ) : (
            <div className="workspace-form">
              <p className="muted">
                Save each option’s plan and follow-ups as a shared draft branch.
              </p>
              <Button
                variant="primary"
                disabled={!!busy}
                onClick={() => void saveBranches()}
              >
                Save both branches
              </Button>
            </div>
          )}
        </section>
      )}
      {busy && <p role="status">{busy}</p>}
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
    </>
  );
}

function OptionFields({
  label,
  option,
  onChange,
  disabled,
}: {
  label: string;
  option: DecisionOption;
  onChange: (option: DecisionOption) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="decision-option workspace-form">
      <legend>{label}</legend>
      <label>
        {label} name
        <input
          value={option.name}
          maxLength={100}
          required
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...option, name: event.target.value })
          }
        />
      </label>
      <label>
        {label} wording
        <textarea
          value={option.wording}
          maxLength={decisionLimits.wording}
          rows={3}
          required
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...option, wording: event.target.value })
          }
        />
      </label>
    </fieldset>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Button } from "./ui";
import { compareWording, type WordingChange } from "../domain/plan-diff";
import {
  readPlanPair,
  type PlanPair,
  type PlanReference,
} from "../platform/confluence-plan";
import type { TicketText } from "../platform/jira-checkpoints";

export function LinkedPlan({
  plan,
  ticket,
  issueKey,
}: {
  plan: PlanReference;
  ticket: TicketText;
  issueKey: string;
}) {
  const [openError, setOpenError] = useState("");
  const [versions, setVersions] = useState<PlanPair | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setVersions(null);
    setError("");
    setOpenError("");
    readPlanPair(plan)
      .then((result) => {
        if (active) setVersions(result);
      })
      .catch((err: unknown) => {
        if (active)
          setError(
            err instanceof Error
              ? err.message
              : "Couldn’t load the linked plan.",
          );
      });
    return () => {
      active = false;
    };
  }, [plan]);
  if (error)
    return (
      <div className="linked-plan" role="alert">
        <h3>Linked Confluence plan</h3>
        <p>{error}</p>
      </div>
    );
  if (!versions)
    return <p role="status">Loading the saved and current plan…</p>;
  return (
    <>
      <PlanComparison versions={versions} ticket={ticket} issueKey={issueKey} />
      <Button
        size="small"
        onClick={async () => {
          try {
            const { router } = await import("@forge/bridge");
            await router.open("/wiki/pages/viewpage.action?pageId=" + plan.id);
          } catch {
            setOpenError(
              "Couldn’t open the page. Use its page ID to find it in Confluence.",
            );
          }
        }}
      >
        View plan in Confluence
      </Button>
      {openError && <p role="alert">{openError}</p>}
    </>
  );
}

export function PassageChanges({ groups }: { groups: WordingChange[] }) {
  return groups.map((change, i) => (
    <div className="plan-change" key={i}>
      {change.before.length > 0 && (
        <div className="plan-removed">
          <strong>Removed</strong>
          <p>{change.before.join(" ")}</p>
        </div>
      )}
      {change.after.length > 0 && (
        <div className="plan-added">
          <strong>Added</strong>
          <p>{change.after.join(" ")}</p>
        </div>
      )}
    </div>
  ));
}

export function PlanComparison({
  versions: { saved, current },
  ticket,
  issueKey,
  baselineIsReview = false,
}: {
  versions: PlanPair;
  ticket: TicketText;
  issueKey: string;
  baselineIsReview?: boolean;
}) {
  const diff = useMemo(
    () => compareWording(saved.text, current.text),
    [saved.text, current.text],
  );
  const renamed = saved.title !== current.title;
  return (
    <section className="linked-plan">
      <h3>Linked plan</h3>
      <div className="plan-grid">
        <article>
          <h4>{current.title}</h4>
          <p className="plan-meta">
            Confluence · {baselineIsReview ? "Reviewed" : "Saved"} v
            {saved.version} · Current v{current.version}
          </p>
          {renamed && <p>Previously titled “{saved.title}”.</p>}
          {saved.version === current.version ? (
            <p>The plan is still on the saved version.</p>
          ) : diff.fullText ? (
            <>
              <p>
                The page text changed. Open both versions to compare a document
                of this size.
              </p>
              <details>
                <summary>Saved page text</summary>
                <p className="plan-wording">{saved.text}</p>
              </details>
              <details>
                <summary>Current page text</summary>
                <p className="plan-wording">{current.text}</p>
              </details>
            </>
          ) : diff.groups.length ? (
            <PassageChanges groups={diff.groups} />
          ) : (
            <p>
              The published version changed. The page wording matches the{" "}
              {baselineIsReview ? "last reviewed version." : "checkpoint."}
            </p>
          )}
        </article>
        <article>
          <h4>{ticket.summary}</h4>
          <p className="plan-meta">Jira · {issueKey} · Current ticket</p>
          <p className="plan-wording">
            {ticket.description || "No description"}
          </p>
        </article>
      </div>
    </section>
  );
}

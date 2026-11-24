import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, PageTitle } from "../components/ui";
import { loadProjectInbox } from "../platform/branch-inbox";
import { listPlanReviews } from "../platform/plan-reviews";
import { readAttentionSignals } from "../platform/jira-checkpoints";
import { workspaceRequest } from "../platform/workspace";
import { runtime } from "../platform/runtime";

type Item = {
  id: string;
  title: string;
  detail: string;
  href: string;
  minutes: number;
  severity: number;
  since?: string;
  ticket?: string;
  cityDate?: string;
  dependents?: number;
  mandatory?: boolean;
};
type Work = {
  proposals: Array<{
    id: string;
    name: string;
    createdAt: string;
    held?: number;
  }>;
  publications: Array<{
    id: string;
    proposalId: string;
    approvedAt: string;
    steps: string[];
  }>;
  questions?: Array<{
    id: string;
    runId: string;
    createdAt: string;
    question: string;
  }>;
};

async function gather(signal: AbortSignal) {
  const [plans, drafts, work] = await Promise.allSettled([
    listPlanReviews(signal),
    loadProjectInbox(signal),
    workspaceRequest<Work>("attention"),
  ]);
  const items: Item[] = [];
  let partial = false;
  if (plans.status === "fulfilled") {
    partial ||= !!plans.value.error || !!plans.value.unchecked.length;
    for (const row of plans.value.items)
      items.push({
        id: "plan:" + row.key + ":" + row.current,
        title: row.key + " · " + row.summary,
        detail:
          "Published plan moved from v" +
          row.baseline +
          " to v" +
          row.current +
          ".",
        href: "/jira?view=plans&reviewTicket=" + encodeURIComponent(row.key),
        minutes: 5,
        severity: 0.7,
        ticket: row.key,
      });
  } else partial = true;
  if (drafts.status === "fulfilled") {
    partial ||= !!drafts.value.error || !!drafts.value.unchecked.length;
    for (const row of drafts.value.drafts) {
      if (row.setAside) continue;
      items.push({
        id: "draft:" + row.revision.revisionId,
        title: row.ticketKey + " · " + row.revision.name,
        detail: row.conflicts.length
          ? "Both the draft and current Jira ticket changed " +
            row.conflicts.join(" and ") +
            "."
          : "Draft wording is ready to compare.",
        href:
          "/jira?view=branches&revision=" +
          encodeURIComponent(row.revision.revisionId),
        minutes: row.conflicts.length ? 5 : 2,
        severity: row.conflicts.length ? 0.8 : 0.45,
        ticket: row.ticketKey,
        since: row.revision.created,
      });
    }
  } else partial = true;
  if (work.status === "fulfilled") {
    const alreadyReviewed = new Set(
      work.value.publications.map((entry) => entry.proposalId),
    );
    for (const proposal of work.value.proposals.filter(
      (entry) => entry.held || !alreadyReviewed.has(entry.id),
    ))
      items.push({
        id: "proposal:" + proposal.id,
        title: proposal.name,
        detail: proposal.held
          ? "Some fields depend on evidence that needs review."
          : "A shared branch revision is ready for human review.",
        href: "/jira?view=workspace&record=proposal&id=" + proposal.id,
        minutes: 5,
        severity: proposal.held ? 0.8 : 0.55,
        since: proposal.createdAt,
      });
    for (const receipt of work.value.publications) {
      const unresolved = receipt.steps.filter(
        (step) => step !== "applied" && step !== "already_present",
      );
      if (!unresolved.length) continue;
      const recovery = unresolved.includes("verification_required");
      items.push({
        id: "publication:" + receipt.id,
        title: recovery
          ? "Verify a publication"
          : "Continue an approved publication",
        detail: recovery
          ? "Check whether the previous write reached its source."
          : "Some approved records still need review or application.",
        href: "/jira?view=workspace&record=publication&id=" + receipt.id,
        minutes: recovery ? 10 : 5,
        severity: recovery ? 1 : 0.7,
        mandatory: recovery,
        since: receipt.approvedAt,
      });
    }
    for (const question of work.value.questions ?? [])
      items.push({
        id: "question:" + question.id,
        title: question.question,
        detail: "This Codex run is waiting for a decision.",
        href: "/jira?view=workspace&record=session&id=" + question.runId,
        minutes: 2,
        severity: 0.65,
        since: question.createdAt,
      });
  } else partial = true;
  const keys = [
    ...new Set(items.flatMap((entry) => (entry.ticket ? [entry.ticket] : []))),
  ].slice(0, 20);
  const byTicket = new Map<
    string,
    Awaited<ReturnType<typeof readAttentionSignals>>
  >();
  for (let i = 0; i < keys.length && !signal.aborted; i += 4) {
    await Promise.all(
      keys.slice(i, i + 4).map(async (key) => {
        try {
          byTicket.set(key, await readAttentionSignals(key));
        } catch {
          partial = true;
        }
      }),
    );
  }
  return {
    items: items.map((entry) => ({
      ...entry,
      cityDate: byTicket.get(entry.ticket ?? "")?.due,
      dependents: byTicket.get(entry.ticket ?? "")?.dependents,
    })),
    partial,
  };
}

const day = 86_400_000;
function priority(item: Item, now: number) {
  const deadline = item.cityDate
    ? Date.parse(item.cityDate + "T23:59:59")
    : Infinity;
  const remaining = deadline - now;
  const urgency =
    remaining <= 0
      ? 1
      : remaining <= day
        ? 0.9
        : remaining <= 3 * day
          ? 0.7
          : remaining <= 7 * day
            ? 0.4
            : 0.1;
  const age = item.since
    ? Math.max(0, Math.min((now - Date.parse(item.since)) / (7 * day), 1))
    : 0;
  return {
    score: Math.round(
      100 *
        (0.45 * item.severity +
          0.25 * urgency +
          0.2 * Math.min((item.dependents ?? 0) / 10, 1) +
          0.1 * (age || 0)),
    ),
    must: !!item.mandatory || remaining <= day,
  };
}

function readPins(key: string): string[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(data)
      ? data.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function LiveAttention() {
  const [data, setData] = useState<Awaited<ReturnType<typeof gather>>>();
  const [attempt, setAttempt] = useState(0);
  const [budget, setBudget] = useState(10);
  const key =
    "kinlet.attention.pins." +
    runtime.cloudId +
    "." +
    runtime.projectId +
    "." +
    runtime.accountId;
  const [pins, setPins] = useState(() => readPins(key));
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined);
    gather(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setData(value);
      },
      () => {
        if (!controller.signal.aborted) setData({ items: [], partial: true });
      },
    );
    return () => controller.abort();
  }, [attempt]);
  const now = Date.now();
  const ordered = (data?.items ?? [])
    .map((item) => ({
      ...item,
      ...priority(item, now),
      pinned: pins.includes(item.id),
    }))
    .sort(
      (a, b) =>
        Number(b.must) - Number(a.must) ||
        Number(b.pinned) - Number(a.pinned) ||
        b.score - a.score ||
        a.id.localeCompare(b.id),
    );
  let used = 0;
  const selected = new Set<string>();
  for (const item of ordered.filter((item) => item.must || item.pinned)) {
    used += item.minutes;
    selected.add(item.id);
  }
  const candidates = ordered
    .filter((item) => !selected.has(item.id))
    .sort(
      (a, b) => b.score / b.minutes - a.score / a.minutes || b.score - a.score,
    );
  for (const item of candidates) {
    if (used + item.minutes <= budget) {
      used += item.minutes;
      selected.add(item.id);
    }
  }
  function pin(id: string) {
    const next = pins.includes(id)
      ? pins.filter((value) => value !== id)
      : [...pins, id];
    setPins(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Current session still keeps the pin. */
    }
  }
  function rows(items: typeof ordered) {
    return (
      <ul className="workspace-records">
        {items.map((item) => (
          <li key={item.id} className="attention-live-row">
            <div>
              <Link className="text-link" to={item.href}>
                {item.title}
              </Link>
              <p>{item.detail}</p>
              {item.ticket && (
                <Link
                  className="text-link"
                  to={"/jira?ticket=" + encodeURIComponent(item.ticket)}
                >
                  Open ticket and linked goals
                </Link>
              )}
              <small>
                {item.minutes} min · Priority {item.score}/100
                {item.cityDate && " · Jira due " + item.cityDate}
                {!!item.dependents &&
                  " · Blocks " + item.dependents + " visible tickets"}
              </small>
            </div>
            <Button
              size="small"
              aria-pressed={item.pinned}
              onClick={() => pin(item.id)}
            >
              {item.pinned ? "Unpin" : "Pin"}
            </Button>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <>
      <PageTitle
        title="Needs attention"
        description="Choose which plan changes, drafts and publications to review next."
        actions={
          <Link className="text-link" to="/jira">
            Back to Jira checkpoints
          </Link>
        }
      />
      <section className="card padded-card workspace-card">
        <div className="live-heading">
          <label className="live-select">
            Review time{" "}
            <select
              aria-label="Review time"
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
            >
              {[5, 10, 15, 30].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutes
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={!data}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Refresh priorities
          </Button>
        </div>
        {!data && <p role="status">Checking this project…</p>}
        {data?.partial && (
          <p role="status">
            Some sources could not be checked. The list may be incomplete.
          </p>
        )}
        {data && !ordered.length && <p>No visible decisions need attention.</p>}
        {!!ordered.length && (
          <>
            <h2>Review now · {used} min</h2>
            {rows(ordered.filter((item) => selected.has(item.id)))}
            {!!ordered.filter((item) => !selected.has(item.id)).length && (
              <>
                <h2>Remaining decisions</h2>
                {rows(ordered.filter((item) => !selected.has(item.id)))}
              </>
            )}
          </>
        )}
      </section>
    </>
  );
}

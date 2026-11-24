import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  GitBranch,
  GitPullRequest,
  History,
  Lightbulb,
  MoreHorizontal,
  Pin,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../app-context";
import { AgentSummary } from "../components/Shell";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  PageTitle,
  SectionHeading,
  SourceChip,
} from "../components/ui";
import { budgetAttention, formatDate, getAttention } from "../domain/model";
import type { AttentionItem } from "../domain/types";

function DecisionCard({ item }: { item: AttentionItem }) {
  const { state, act, open } = useApp();
  const navigate = useNavigate();
  const [details, setDetails] = useState(false);
  const [menu, setMenu] = useState(false);
  const isDrift = item.kind === "drift";
  const Icon = isDrift
    ? TriangleAlert
    : item.kind === "question"
      ? Lightbulb
      : item.kind === "recovery"
        ? TriangleAlert
        : GitPullRequest;
  return (
    <article
      className={`decision-card ${isDrift ? "decision-featured" : ""}`}
      data-testid={`decision-${item.kind}`}
    >
      <div className="decision-top">
        <div
          className={`decision-symbol ${isDrift ? "symbol-amber" : item.kind === "question" ? "symbol-violet" : "symbol-blue"}`}
        >
          <Icon size={20} />
        </div>
        <div className="decision-meta">
          <Badge
            tone={
              isDrift ? "amber" : item.kind === "question" ? "violet" : "blue"
            }
          >
            {item.label}
          </Badge>
          {state.pinned.includes(item.id) ? <Pin size={13} /> : null}
        </div>
        <div className="decision-time">
          <Clock3 size={13} />
          {item.minutes} min
        </div>
        <div className="relative">
          <button
            className="icon-button"
            aria-label={`Options for ${item.title}`}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={19} />
          </button>
          {menu ? (
            <div className="dropdown-menu small-menu">
              <button
                onClick={() => {
                  act((s) => {
                    s.pinned = s.pinned.includes(item.id)
                      ? s.pinned.filter((id) => id !== item.id)
                      : [...s.pinned, item.id];
                  });
                  setMenu(false);
                }}
              >
                <Pin size={13} />
                {state.pinned.includes(item.id) ? "Unpin" : "Pin decision"}
              </button>
              <button
                onClick={() => {
                  act((s) => {
                    s.dismissed.push(item.id);
                  }, "Decision dismissed.");
                  setMenu(false);
                }}
              >
                Dismiss decision
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <h2>{item.title}</h2>
      <p className="decision-description">{item.description}</p>
      <div className="decision-evidence">
        {item.sourceIds.map((id) => (
          <SourceChip key={id} id={id} compact />
        ))}
        {item.kind === "drift" ? (
          <span className="impact-tag">
            <GitBranch size={12} />{item.sourceIds.length} affected {item.sourceIds.length === 1 ? "source" : "sources"}
          </span>
        ) : null}
      </div>
      {details ? (
        <div className="rank-explanation">
          <strong>Reason for review</strong>
          <p>
            {isDrift
              ? "At least one proposed field has changed on Main since the starting checkpoint. Compare the versions before publishing."
              : item.kind === "question"
                ? "The session has an unanswered question. Your answer will be saved with the session."
                : item.kind === "recovery" ? "Publication stopped before all updates finished. Review the remaining records." : "Select the proposed changes to publish."}
          </p>
          <span>
            Priority {item.priority}/100 · estimated review {item.minutes}{" "}
            minutes · sample ranking
          </span>
        </div>
      ) : null}
      <div className="decision-footer">
        <div className="reviewer">
          <Avatar size="small" name={state.settings.reviewer} />
          <span>Awaiting review</span>
          <button onClick={() => setDetails(!details)}>
            {details ? "Hide details" : "Show details"}
          </button>
        </div>
        <Button
          variant={isDrift ? "primary" : "secondary"}
          onClick={() =>
            item.kind === "question"
              ? open({ type: "question", questionId: item.id })
              : navigate(item.route)
          }
        >
          {item.kind === "question"
            ? "Make a decision"
            : isDrift
              ? "Review the changes"
              : item.kind === "recovery"
                ? "Verify updates"
                : "Review proposal"}
          <ArrowRight size={14} />
        </Button>
      </div>
    </article>
  );
}
export function Attention() {
  const { state, act, open } = useApp();
  const navigate = useNavigate();
  const items = getAttention(state);
  const plan = budgetAttention(items, state.budget, state.pinned);
  const [other, setOther] = useState(false);
  return (
    <div className="page attention-page">
      <PageTitle
        title="Attention"
        actions={<Link className="button button-secondary" to="/jira?example=checkout">Try the checkout example</Link>}
        description={
          items.length ? (
            <>
              <strong>{items.length} {items.length === 1 ? "decision" : "decisions"}</strong> awaiting review.
            </>
          ) : (
            "No decisions need review."
          )
        }
      />
      <div className="stat-grid">
        <button
          className="stat-card"
          onClick={() =>
            document
              .getElementById("decisions")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          <div className="stat-icon stat-amber">
            <Target size={17} />
          </div>
          <span>Needs your attention</span>
          <strong>
            {items.length}
            <small>decisions</small>
          </strong>
          <div className="stat-detail">
            {items.some((i) => i.kind === "drift") ? (
              <>
                <span className="tiny-dot amber" />1 context mismatch
              </>
            ) : (
              <>
                <span className="tiny-dot green" />
                All caught up
              </>
            )}
          </div>
        </button>
        <button className="stat-card" onClick={() => navigate("/sessions")}>
          <div className="stat-icon stat-violet">
            <Sparkles size={17} />
          </div>
          <span>Agent sessions</span>
          <strong>
            {state.runs.length}
            <small>recorded</small>
          </strong>
          <div className="stat-detail">
            {state.runs.filter((r) => r.status === "waiting").length} waiting
            for your input
            <ArrowUpRight size={13} />
          </div>
        </button>
        <button className="stat-card" onClick={() => navigate("/branches")}>
          <div className="stat-icon stat-blue">
            <GitBranch size={17} />
          </div>
          <span>Parallel approaches</span>
          <strong>
            {
              state.branches.filter(
                (b) => b.status !== "archived" && b.status !== "published",
              ).length
            }
            <small>branches</small>
          </strong>
          <div className="stat-detail">
            View active branches
            <ArrowUpRight size={13} />
          </div>
        </button>
        <button
          className="stat-card"
          onClick={() => navigate(`/checkpoints/${state.observedId}`)}
        >
          <div className="stat-icon stat-teal">
            <History size={17} />
          </div>
          <span>Latest checkpoint</span>
          <strong className="checkpoint-stat">
            {state.observedId}
            <small>saved state</small>
          </strong>
          <div className="stat-detail">
            <ShieldCheck size={12} />
            Inspect saved sources
          </div>
        </button>
      </div>
      <div className="attention-layout">
        <section id="decisions" className="decision-column">
          <div className="focus-toolbar">
            <div>
              <h2>
                Decisions to review <span>{plan.selected.length}</span>
              </h2>
              <p>Selected decisions fit the available review time.</p>
            </div>
            <label className="budget-select">
              <Clock3 size={14} />
              <select
                aria-label="Available attention budget"
                value={state.budget}
                onChange={(e) =>
                  act((s) => {
                    s.budget = Number(e.target.value);
                  })
                }
              >
                {[5, 10, 20, 30].map((n) => (
                  <option key={n} value={n}>
                    {n} minutes
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </label>
          </div>
          {items.length === 0 ? (
            <div className="card">
              <EmptyState
                title="No pending decisions"
                description="New proposals and open questions appear here."
                icon="check"
                action={
                  <Button onClick={() => open({ type: "branch" })}>
                    Create a branch
                    <ArrowRight size={14} />
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              {plan.selected.map((item) => (
                <DecisionCard key={item.id} item={item} />
              ))}
              {plan.remaining.length ? (
                <div className="outside-budget">
                  <button onClick={() => setOther(!other)}>
                    <span>
                      <Clock3 size={15} />
                      {plan.remaining.length} more decision
                      {plan.remaining.length === 1 ? "" : "s"} outside this
                      focus window
                    </span>
                    <ChevronDown size={16} className={other ? "rotate" : ""} />
                  </button>
                  {other
                    ? plan.remaining.map((item) => (
                        <DecisionCard
                          key={item.id}
                          item={item}
                        />
                      ))
                    : null}
                </div>
              ) : (
                <div className="end-note">
                  <Check size={14} />
                  All pending decisions are included.
                </div>
              )}
            </>
          )}
        </section>
        <aside className="attention-aside">
          <div className="card focus-card">
            <div className="small-heading">
              <Clock3 size={15} />
              <span>REVIEW TIME</span>
            </div>
            <div className="focus-dial">
              <svg viewBox="0 0 136 136" aria-hidden="true">
                <circle cx="68" cy="68" r="57" className="dial-track" />
                <circle
                  cx="68"
                  cy="68"
                  r="57"
                  className="dial-fill"
                  strokeDasharray={`${Math.min(plan.total / state.budget, 1) * 358} 358`}
                  transform="rotate(-90 68 68)"
                />
              </svg>
              <div>
                <strong>
                  {plan.total}
                  <span> / {state.budget}</span>
                </strong>
                <small>minutes planned</small>
              </div>
            </div>
            <p>
              {plan.total > state.budget
                ? "Required recovery exceeds your window."
                : plan.total === 0
                  ? "No review time allocated."
                  : `${Math.max(0, state.budget - plan.total)} minute${state.budget - plan.total === 1 ? "" : "s"} available.`}
            </p>
            <div className="focus-note">
              <span className="tiny-dot blue" />
              Estimated time to review the selected decisions.
            </div>
          </div>
          <div className="card agent-work-card">
            <SectionHeading
              title="Agent sessions"
              action={<Sparkles size={15} />}
            />
            <p className="muted small">
              Recorded work, with the context attached.
            </p>
            <AgentSummary />
            <Link className="subtle-link" to="/sessions">
              Explore agent sessions
              <ArrowRight size={13} />
            </Link>
          </div>
          <div className="card activity-card">
            <SectionHeading
              title="Recent activity"
              action={<History size={15} />}
            />
            <div className="activity-list">
              {state.activities.slice(0, 3).map((a, i) => (
                <div className="activity-item" key={a.id}>
                  <span className={`activity-dot ${i === 0 ? "blue" : ""}`} />
                  <div>
                    <strong>{a.title}</strong>
                    <p>{a.detail}</p>
                    <small>{formatDate(a.at)}</small>
                  </div>
                </div>
              ))}
            </div>
            <Link className="subtle-link" to="/history">
              View project history
              <ArrowRight size={13} />
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

import { LiveAttention } from "./LiveAttention";
import { LiveWorkspace } from "./LiveWorkspace";
import { ProjectSections, type ProjectSection } from "./ProjectSections";
import { JiraReviewHome, JiraReviewTools } from "../components/JiraReviewHome";
import { LiveCheckoutDemo } from "../components/LiveCheckoutDemo";
import { DecisionImpact } from "./DecisionImpact";
import { LinkedGoals } from "../components/LinkedGoals";
import { BranchInbox } from "../components/BranchInbox";
import { DecisionSearch } from "../components/DecisionSearch";
import { TicketDecisionHistory } from "../components/ReviewDecision";
import { CheckpointComparison } from "../components/CheckpointComparison";
import { TicketBranches } from "../components/TicketBranches";
import { jiraBranchStore } from "../platform/ticket-branches";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BrandMark, Button, PageTitle } from "../components/ui";
import { CheckoutExample } from "./CheckoutExample";
import { NeedsReview } from "../components/NeedsReview";
import { LinkedPlan } from "../components/PlanComparison";
import { parsePageId, pinPlan } from "../platform/confluence-plan";
import { runtime } from "../platform/runtime";
import {
  attachCheckpoint,
  readCheckpoint,
  readTicket,
  sameText,
  type CheckpointFile,
  type SavedTicket,
  type Ticket,
  type TicketText,
} from "../platform/jira-checkpoints";

const dateLabel = (value: string) => new Date(value).toLocaleString();
const checkpointLabel = (file: CheckpointFile) =>
  dateLabel(file.created) +
  " · " +
  (file.author?.displayName ?? "Jira user") +
  " · #" +
  file.id;
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed. Try again.";

export function JiraCheckpoints() {
  const [params, setParams] = useSearchParams();
  const lastReviewedIssue = useRef<string | undefined>(undefined);
  const [lastSearch, setLastSearch] = useState("");
  const showExample = params.get("example") === "checkout";
  const showSearch = params.get("view") === "decisions" && runtime.connected;
  const showInbox = params.get("view") === "branches" && runtime.connected;
  const showAttention = params.get("view") === "attention" && runtime.connected;
  const showPlans = params.get("view") === "plans" && runtime.connected;
  const showWorkspace = params.get("view") === "workspace" && runtime.connected;
  const showPractice = params.get("view") === "practice" && runtime.connected;
  const showDecisionImpact =
    params.get("view") === "compare-decision" && runtime.connected;
  const selected = params.get("ticket")?.trim().toUpperCase() ?? "";
  const view = params.get("view");
  const projectSection = (
    [
      "history",
      "project-branches",
      "agents",
      "project-reviews",
      "settings",
    ] as const
  ).find((section) => section === view);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [selected, view, showExample]);
  return (
    <main className="live-shell">
      <header className="live-nav">
        <Link to="/jira" className="live-brand">
          <BrandMark /> Kinlet
        </Link>
        {runtime.connected && <span>{runtime.projectKey}</span>}
        <nav aria-label="Project navigation" className="kinlet-project-nav">
          <Link to="/jira">Overview</Link>
          <Link to="/jira?view=history">History</Link>
          <Link to="/jira?view=project-branches">Branches</Link>
          <Link to="/jira?view=agents">Agents</Link>
          <Link to="/jira?view=project-reviews">Reviews</Link>
          <Link to="/jira?view=settings">Settings</Link>
        </nav>
      </header>
      <div className="page live-page">
        {projectSection && runtime.connected ? (
          <ProjectSections section={projectSection as ProjectSection} />
        ) : showExample ? (
          <CheckoutExample />
        ) : showPractice ? (
          <>
            <Link className="text-link kinlet-back" to="/jira">
              Back to review home
            </Link>
            <LiveCheckoutDemo
              onBranch={async (id) =>
                setParams({ view: "workspace", record: "branch", id })
              }
              onCheckpoint={async (id) =>
                setParams({ view: "workspace", record: "checkpoint", id })
              }
            />
          </>
        ) : showAttention ? (
          <LiveAttention />
        ) : showPlans ? (
          <>
            <PageTitle
              title="Plan reviews"
              actions={
                <Link className="text-link" to="/jira?view=attention">
                  Back to Needs attention
                </Link>
              }
            />
            <NeedsReview
              key={params.get("reviewTicket")}
              initialTicket={params.get("reviewTicket") ?? undefined}
              onReviewSaved={(id) => {
                lastReviewedIssue.current = id;
              }}
            />
          </>
        ) : showWorkspace ? (
          <LiveWorkspace
            key={params.get("id") ?? "home"}
            deepLink={{ kind: params.get("record"), id: params.get("id") }}
          />
        ) : showDecisionImpact ? (
          <DecisionImpact initialTicket={params.get("anchor") ?? ""} />
        ) : showInbox ? (
          <>
            <PageTitle
              title="Branch inbox"
              description="Review draft edits across this project. Fields that also changed in Jira appear first."
              actions={
                <Link className="text-link" to="/jira">
                  Back to review home
                </Link>
              }
            />
            <BranchInbox
              key={params.get("revision")}
              initialRevision={params.get("revision") ?? undefined}
            />
          </>
        ) : showSearch ? (
          <>
            <PageTitle
              title="Find a decision"
              description="Find the recorded reason for a change across this project’s tickets."
              actions={
                <Link className="text-link" to="/jira">
                  Back to review home
                </Link>
              }
            />
            <section className="card padded-card">
              <DecisionSearch
                recentlyReviewedIssue={lastReviewedIssue.current}
                initialText={lastSearch}
                onSubmitted={setLastSearch}
              />
            </section>
          </>
        ) : selected && runtime.connected ? (
          <>
            <Link
              className="text-link kinlet-back"
              to={params.has("review") ? "/jira?view=decisions" : "/jira"}
            >
              {params.has("review")
                ? "Back to decision search"
                : "Back to tasks"}
            </Link>
            <TicketHistory
              key={selected}
              issueKey={selected}
              selectedReview={params.get("review") ?? undefined}
            />
            <JiraReviewTools ticketKey={selected} />
          </>
        ) : (
          <JiraReviewHome
            onReviewSaved={(id) => {
              lastReviewedIssue.current = id;
            }}
          />
        )}
      </div>
    </main>
  );
}

type Comparison = { file: CheckpointFile; snapshot: SavedTicket };
function TicketHistory({
  issueKey,
  selectedReview,
}: {
  issueKey: string;
  selectedReview?: string;
}) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selectedFile = useRef("");
  const [draftPage, setDraftPage] = useState<string | null>(null);
  const [savedPageId, setSavedPageId] = useState("");
  const pageInput = draftPage ?? savedPageId;
  const pending = useRef<{
    name: string;
    text: TicketText;
    pageId: string;
  } | null>(null);
  const generation = useRef(0);
  const branches = useMemo(
    () => jiraBranchStore(issueKey, setTicket),
    [issueKey],
  );
  const checkpointChoices = useMemo(
    () =>
      ticket?.files.map((file) => ({
        id: file.id,
        label: checkpointLabel(file),
        read: () => readCheckpoint(ticket, file),
      })) ?? [],
    [ticket],
  );

  async function load(fileId = selectedFile.current, save = false) {
    const version = ++generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    let sourceLoaded = false;
    setComparison(null);
    try {
      const current = await readTicket(issueKey);
      if (version !== generation.current) return;
      sourceLoaded = true;
      setTicket(current);
      let chosen =
        current.files.find((f) => String(f.id) === fileId) ?? current.files[0];
      if (save && ticket) {
        if (!sameText(current, ticket)) {
          pending.current = null;
          setNotice(
            "The ticket changed before saving. Review its current wording, then save again.",
          );
        } else {
          const pageId = pageInput.trim() ? parsePageId(pageInput) : "";
          if (
            !pending.current ||
            !sameText(pending.current.text, current) ||
            pending.current.pageId !== pageId
          ) {
            pending.current = {
              name: "kinlet-checkpoint-" + crypto.randomUUID() + ".json",
              text: current,
              pageId,
            };
          }
          const existing = current.files.find(
            (f) => f.filename === pending.current?.name,
          );
          if (existing) chosen = existing;
          else {
            const plan = pageId ? await pinPlan(pageId) : undefined;
            if (version !== generation.current) return;
            chosen = await attachCheckpoint(
              current,
              pending.current.name,
              plan,
            );
          }
          if (version !== generation.current) return;
          if (!existing) current.files = [chosen, ...current.files];
          setTicket({ ...current });
          setNotice("Checkpoint saved to " + current.key + ".");
          pending.current = null;
          setDraftPage(null);
        }
      }
      if (chosen) {
        selectedFile.current = String(chosen.id);
        const snapshot = await readCheckpoint(current, chosen);
        if (version === generation.current) {
          setSavedPageId(snapshot.plan?.id ?? "");
          setComparison({ file: chosen, snapshot });
        }
      } else setSavedPageId("");
    } catch (err) {
      if (version === generation.current) {
        // Discard cached source text if Jira has revoked access since the last read.
        if (!sourceLoaded) {
          setTicket(null);
          setSavedPageId("");
        }
        // Keep the explicit page selection on a failed save so retry cannot downgrade it to ticket-only.
        if (save) setDraftPage(pageInput);
        setError(message(err));
      }
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
    // The route keys this component by ticket. Reloads and saves are explicit actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section className="card padded-card live-ticket" aria-busy={busy}>
      <div className="live-heading">
        <h2>{ticket?.key ?? issueKey}</h2>
        <div className="live-heading-actions">
          {ticket && (
            <Button
              onClick={async () => {
                try {
                  const { router } = await import("@forge/bridge");
                  await router.open(
                    "/browse/" + encodeURIComponent(ticket.key),
                  );
                } catch {
                  setError(
                    "Couldn’t open the ticket. Find it in Jira using its ticket key.",
                  );
                }
              }}
            >
              View in Jira
            </Button>
          )}
          <Button disabled={busy} onClick={() => void load()}>
            Refresh checkpoint
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">Updating ticket…</p>}
      {ticket && (
        <>
          {!busy && (
            <TicketDecisionHistory
              ticket={ticket}
              selectedId={selectedReview}
              onTicketUpdated={setTicket}
            />
          )}
          <label className="plan-field">
            Confluence plan (optional)
            <input
              placeholder="Page URL or numeric page ID"
              value={pageInput}
              onChange={(event) => setDraftPage(event.target.value)}
              disabled={busy}
            />
          </label>
          <div className="live-actions">
            <p>
              Saving attaches the ticket wording and linked page version to this
              ticket. Page text stays in Confluence. Leave the field blank to
              save just the ticket.
            </p>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void load(selectedFile.current, true)}
            >
              Save checkpoint
            </Button>
          </div>
          {ticket.files.length > 0 ? (
            <label className="live-select">
              Saved checkpoint
              <select
                disabled={busy}
                value={
                  comparison ? String(comparison.file.id) : selectedFile.current
                }
                onChange={(e) => {
                  setDraftPage(null);
                  setSavedPageId("");
                  void load(e.target.value);
                }}
              >
                {ticket.files.map((f) => (
                  <option key={f.id} value={String(f.id)}>
                    {checkpointLabel(f)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>No checkpoints saved on this ticket.</p>
          )}
          {!busy && (
            <div className="live-heading-actions checkpoint-tools">
              <CheckpointComparison
                ticketKey={ticket.key}
                choices={checkpointChoices}
                selectedId={selectedFile.current}
              />
              <TicketBranches
                ticketKey={ticket.key}
                choices={checkpointChoices}
                selectedId={selectedFile.current}
                store={branches}
              />
            </div>
          )}
          {comparison && (
            <p className="live-status">
              {sameText(comparison.snapshot, ticket)
                ? "Summary and description match."
                : comparison.snapshot.summary === ticket.summary
                  ? "Description changed since this checkpoint."
                  : comparison.snapshot.description === ticket.description
                    ? "Summary changed since this checkpoint."
                    : "Summary and description changed since this checkpoint."}
            </p>
          )}
          {comparison?.snapshot.plan && (
            <LinkedPlan
              key={comparison.file.id}
              plan={comparison.snapshot.plan}
              ticket={ticket}
              issueKey={ticket.key}
            />
          )}
          {runtime.cloudId && (
            <LinkedGoals
              key={ticket.id}
              issueId={ticket.id}
              cloudId={runtime.cloudId}
            />
          )}
          <div className="live-versions">
            {comparison && (
              <TicketVersion
                title="Saved checkpoint"
                date={comparison.file.created}
                fields={comparison.snapshot}
              />
            )}
            <TicketVersion
              title="Current Jira ticket"
              date={ticket.updated}
              fields={ticket}
            />
          </div>
        </>
      )}
    </section>
  );
}
function TicketVersion({
  title,
  date,
  fields,
}: {
  title: string;
  date: string;
  fields: TicketText;
}) {
  return (
    <article>
      <h3>{title}</h3>
      <time dateTime={date}>{dateLabel(date)}</time>
      <dl>
        <dt>Summary</dt>
        <dd>{fields.summary}</dd>
        <dt>Description</dt>
        <dd>{fields.description || "No description"}</dd>
      </dl>
    </article>
  );
}

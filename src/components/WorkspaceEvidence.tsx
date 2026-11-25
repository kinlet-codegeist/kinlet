import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  reviewFields,
  sourceKey,
  type BitbucketEvidence,
  type Branch,
  type Citation,
  type CitationReview,
  type Coverage,
  type DraftChange,
  type Observation,
  type ReviewField,
  type ReviewTemplate,
  type SourceRef,
} from "../domain/workspace";
import { plainText } from "../platform/atlassian-text";
import { runtime } from "../platform/runtime";
import { workspaceRequest } from "../platform/workspace";
import { Button } from "./ui";

const fieldLabels = { title: "Title", body: "Wording", priority: "Priority" };
const citationLabels = {
  current: "Current wording matches",
  changed: "Wording changed",
  ambiguous: "More than one match",
  unavailable: "Source unavailable",
};

function sourceUrl(source: SourceRef) {
  if (!runtime.siteUrl) return undefined;
  return new URL(
    source.kind === "jira"
      ? /^\d+$/.test(source.id)
        ? "/secure/ViewIssue.jspa?id=" + source.id
        : "/browse/" + encodeURIComponent(source.id)
      : "/wiki/pages/viewpage.action?pageId=" + encodeURIComponent(source.id),
    runtime.siteUrl,
  ).href;
}

export function CitationList({ citations }: { citations: CitationReview[] }) {
  return (
    <ul className="workspace-records">
      {citations.map((cite, index) => (
        <li key={index}>
          <strong>
            {cite.required ? "Required" : "Context"} ·{" "}
            {citationLabels[cite.status]}
          </strong>
          {cite.source && (
            <a href={sourceUrl(cite.source)} target="_blank" rel="noreferrer">
              {cite.label}
            </a>
          )}
          {cite.version && (
            <small>
              Saved {cite.savedVersion ?? "version"} · Current {cite.version}
            </small>
          )}
          {cite.quote && (
            <blockquote className="decision-quote">{cite.quote}</blockquote>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CitationEditor({
  checkpointId,
  coverage,
  citations,
  onChange,
  disputed,
  onDispute,
  onlyField,
}: {
  checkpointId: string;
  coverage: Coverage;
  citations: NonNullable<DraftChange["citations"]>;
  onChange: (next: NonNullable<DraftChange["citations"]>) => void;
  disputed: ReviewField[];
  onDispute: (next: ReviewField[]) => void;
  onlyField?: ReviewField;
}) {
  const [selectedField, setField] = useState<ReviewField>("body");
  const field = onlyField ?? selectedField;
  const [source, setSource] = useState("");
  const [quote, setQuote] = useState("");
  const [required, setRequired] = useState(true);
  const [passagePreview, setPassagePreview] = useState<{
    title: string;
    text: string;
  }>();
  const items = citations[field] ?? [];
  const from = coverage.sources.find(
    (item) => sourceKey(item.source) === source,
  )?.source;
  useEffect(() => {
    let active = true;
    setPassagePreview(undefined);
    if (from)
      void workspaceRequest<{ saved: Observation }>("compare", {
        baseId: checkpointId,
        source: from,
      }).then(
        ({ saved }) => {
          if (active && saved.status === "captured")
            setPassagePreview({
              title: saved.version.title,
              text: plainText(saved.version.body),
            });
        },
        () => {},
      );
    return () => {
      active = false;
    };
  }, [checkpointId, from]);
  function update(next: Citation[]) {
    onChange({ ...citations, [field]: next });
    if (next.length < 2) onDispute(disputed.filter((value) => value !== field));
  }
  return (
    <details>
      <summary>Evidence for draft edits</summary>
      <p>
        Copy a complete sentence or title from a saved source for the field
        you’re changing.
      </p>
      <label>
        Draft field
        <select
          value={field}
          disabled={!!onlyField}
          onChange={(event) => setField(event.target.value as ReviewField)}
        >
          {reviewFields.map((value) => (
            <option key={value} value={value}>
              {fieldLabels[value]}
            </option>
          ))}
        </select>
      </label>
      {items.map((item, index) => (
        <div className="workspace-choice" key={index}>
          <p>
            {coverage.sources.find(
              (entry) => sourceKey(entry.source) === sourceKey(item.source),
            )?.label ?? "Saved source"}
          </p>
          <blockquote className="decision-quote">{item.quote}</blockquote>
          <label>
            <input
              type="checkbox"
              checked={item.required}
              onChange={(event) => {
                const checked = event.target.checked;
                update(
                  items.map((value, i) =>
                    i === index ? { ...value, required: checked } : value,
                  ),
                );
              }}
            />{" "}
            Required for this edit
          </label>
          <Button
            size="small"
            onClick={() => update(items.filter((_, i) => i !== index))}
          >
            Remove citation
          </Button>
        </div>
      ))}
      {items.length >= 2 && (
        <label>
          <input
            type="checkbox"
            checked={disputed.includes(field)}
            onChange={(event) =>
              onDispute(
                event.target.checked
                  ? [...disputed, field]
                  : disputed.filter((value) => value !== field),
              )
            }
          />
          These sources disagree
        </label>
      )}
      {items.length < 3 && (
        <>
          <label>
            Checkpoint source
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="">Choose a saved source</option>
              {coverage.sources
                .filter((item) => item.status === "captured")
                .map((item) => (
                  <option
                    key={sourceKey(item.source)}
                    value={sourceKey(item.source)}
                  >
                    {item.label}
                  </option>
                ))}
            </select>
          </label>
          {passagePreview && (
            <details>
              <summary>Read saved source</summary>
              <p>
                <strong>{passagePreview.title}</strong>
              </p>
              <p className="plan-wording">{passagePreview.text}</p>
            </details>
          )}
          <label>
            Exact saved wording
            <textarea
              rows={2}
              maxLength={600}
              value={quote}
              onChange={(event) => setQuote(event.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
            />{" "}
            Required for this edit
          </label>
          <Button
            size="small"
            disabled={!from || !quote.trim()}
            onClick={() => {
              if (!from) return;
              update([
                ...items,
                { source: from, quote: quote.trim(), required },
              ]);
              setQuote("");
            }}
          >
            Add citation
          </Button>
        </>
      )}
    </details>
  );
}

export function TemplateSettings({
  templates,
  onSaved,
}: {
  templates: ReviewTemplate[];
  onSaved: (item: ReviewTemplate) => void;
}) {
  const [editing, setEditing] = useState<ReviewTemplate>();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details className="card padded-card workspace-card">
      <summary>Review templates</summary>
      <form
        className="workspace-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!editing) return;
          setBusy(true);
          setError("");
          setStatus("");
          try {
            const saved = await workspaceRequest<ReviewTemplate>(
              "saveTemplate",
              editing,
            );
            setEditing(saved);
            onSaved(saved);
            setStatus("Template saved.");
          } catch (err) {
            setError(String(err instanceof Error ? err.message : err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Template
          <select
            value={editing?.id ?? ""}
            disabled={busy}
            onChange={(event) => {
              setEditing(templates.find(({ id }) => id === event.target.value));
              setStatus("");
              setError("");
            }}
          >
            <option value="">Choose a template</option>
            {templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {editing && (
          <>
            <label>
              Name
              <input
                maxLength={100}
                value={editing.name}
                required
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
              />
            </label>
            <label>
              Starting instructions
              <textarea
                rows={3}
                maxLength={2000}
                value={editing.instructions}
                onChange={(event) =>
                  setEditing({ ...editing, instructions: event.target.value })
                }
              />
            </label>
            <fieldset>
              <legend>Fields that require a citation</legend>
              {reviewFields.map((field) => (
                <label className="workspace-checkbox" key={field}>
                  <input
                    type="checkbox"
                    checked={editing.evidenceFor.includes(field)}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        evidenceFor: event.target.checked
                          ? [...editing.evidenceFor, field]
                          : editing.evidenceFor.filter(
                              (value) => value !== field,
                            ),
                      })
                    }
                  />
                  {fieldLabels[field]}
                </label>
              ))}
            </fieldset>
            <label>
              Who can approve
              <select
                value={editing.approval}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    approval:
                      event.target.value === "admins" ? "admins" : "editors",
                  })
                }
              >
                <option value="editors">Users who can edit the record</option>
                <option value="admins">
                  Project administrators who can edit the record
                </option>
              </select>
            </label>
            <Button type="submit" disabled={busy || !editing.name.trim()}>
              Save template
            </Button>
          </>
        )}
      </form>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
    </details>
  );
}

export function CrossProjectImpact() {
  const [ticket, setTicket] = useState("");
  const [items, setItems] =
    useState<
      Array<{ key: string; title: string; relation: string; status?: string }>
    >();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details className="card padded-card workspace-card">
      <summary>Linked work in other projects</summary>
      <form
        className="workspace-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setItems(undefined);
          try {
            setItems(
              await workspaceRequest("crossProjectImpact", {
                ticket: ticket.trim().toUpperCase(),
              }),
            );
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Couldn’t check linked tickets.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Starting Jira ticket
          <input
            required
            value={ticket}
            onChange={(event) => setTicket(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={busy || !ticket.trim()}>
          Check linked work
        </Button>
      </form>
      {error && <p role="alert">{error}</p>}
      {items?.length === 0 && (
        <p>No visible linked tickets in other projects.</p>
      )}
      {!!items?.length && (
        <ul className="workspace-records">
          {items.map((item) => (
            <li key={item.key}>
              <a
                href={sourceUrl({ kind: "jira", id: item.key })}
                target="_blank"
                rel="noreferrer"
              >
                {item.key} · {item.title}
              </a>{" "}
              <small>
                {item.relation} {item.status}
              </small>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

type ReusedDecision = {
  name: string;
  reason: string;
  publicationId: string;
  approvedAt: string;
  checks: Array<{
    source: SourceRef;
    fields: ReviewField[];
    wording?: string;
    status: string;
  }>;
};

export function BranchReferences({
  branch,
  canManage,
}: {
  branch: Branch;
  canManage: boolean;
}) {
  const [origin, setOrigin] = useState<ReusedDecision | null>();
  const [bitbucket, setBitbucket] = useState<BitbucketEvidence | null>();
  const [file, setFile] = useState<File>();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details
      onToggle={(event) => {
        if (!event.currentTarget.open || bitbucket !== undefined) return;
        void Promise.all([
          workspaceRequest<BitbucketEvidence | null>("branchBitbucket", {
            branchId: branch.id,
          }),
          branch.origin
            ? workspaceRequest<ReusedDecision | null>("branchOrigin", {
                branchId: branch.id,
              })
            : Promise.resolve(null),
        ]).then(
          ([code, prior]) => {
            setBitbucket((current) => current ?? (code?.commit ? code : null));
            setOrigin(prior?.publicationId ? prior : null);
          },
          (err) =>
            setError(
              err instanceof Error ? err.message : "Couldn’t load references.",
            ),
        );
      }}
    >
      <summary>Decision and pull request references</summary>
      {branch.origin && origin === null && (
        <p>The original decision is unavailable.</p>
      )}
      {origin && (
        <details>
          <summary>
            Open original receipt · {origin.publicationId.slice(0, 8)}
          </summary>
          <h3>{origin.name}</h3>
          <p>{origin.reason}</p>
          <time dateTime={origin.approvedAt}>
            {new Date(origin.approvedAt).toLocaleString()}
          </time>
          <ul>
            {origin.checks.map((entry, index) => (
              <li key={index}>
                <a
                  href={sourceUrl(entry.source)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open original source
                </a>
                {entry.wording && <p>{entry.wording}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {bitbucket && (
        <section>
          <h3>Imported Bitbucket context</h3>
          <a href={bitbucket.url} target="_blank" rel="noreferrer">
            Open pull request
          </a>
          <p>
            Commit {bitbucket.commit.slice(0, 12)} · Captured{" "}
            {new Date(bitbucket.observedAt).toLocaleString()}
          </p>
          {bitbucket.statuses.length ? (
            <ul>
              {bitbucket.statuses.map(({ key, state }) => (
                <li key={key}>
                  {key} · {state}
                </li>
              ))}
            </ul>
          ) : (
            <p>No build status captured.</p>
          )}
        </section>
      )}
      {canManage && (
        <form
          className="workspace-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!file || !confirmed || file.size > 16_384) return;
            setBusy(true);
            setError("");
            try {
              setBitbucket(
                await workspaceRequest("importBitbucket", {
                  branchId: branch.id,
                  evidence: JSON.parse(await file.text()),
                  publicConfirmed: confirmed,
                }),
              );
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "Couldn’t import the evidence.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Bitbucket evidence file
            <input
              type="file"
              accept=".json,application/json"
              onChange={(event) => setFile(event.target.files?.[0])}
            />
          </label>
          <label className="workspace-checkbox">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{" "}
            I confirm this pull request and its captured statuses are public.
          </label>
          <Button
            type="submit"
            disabled={busy || !file || file.size > 16_384 || !confirmed}
          >
            Import Bitbucket context
          </Button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

type TimelineEntry = {
  at: string;
  title: string;
  detail?: string;
  id?: string;
  kind?: string;
  source?: SourceRef;
};
export function WorkspaceTimeline({
  proposalId,
  label = "Decision timeline",
}: {
  proposalId: string;
  label?: string;
}) {
  const [timeline, setTimeline] = useState<{
    entries: TimelineEntry[];
    unavailable?: boolean;
  }>();
  const [error, setError] = useState("");
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open)
          void workspaceRequest<typeof timeline>("timeline", {
            proposalId,
          }).then(
            (value) => {
              setTimeline(value);
              setError("");
            },
            (err) =>
              setError(
                err instanceof Error
                  ? err.message
                  : "Couldn’t load the timeline.",
              ),
          );
      }}
    >
      <summary>{label}</summary>
      {error && <p role="alert">{error}</p>}
      {timeline?.unavailable && (
        <p>The timeline contains sources you can no longer view.</p>
      )}
      {!!timeline?.entries.length && (
        <ol>
          {timeline.entries.map((entry, i) => (
            <li key={i}>
              <time dateTime={entry.at}>
                {new Date(entry.at).toLocaleString()}
              </time>
              {" · "}
              {entry.id ? (
                <Link
                  to={
                    "/jira?view=workspace&record=" +
                    entry.kind +
                    "&id=" +
                    entry.id
                  }
                >
                  {entry.title}
                </Link>
              ) : (
                entry.title
              )}
              {entry.detail && <p>{entry.detail}</p>}
              {entry.source && (
                <a
                  href={sourceUrl(entry.source)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open native record
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

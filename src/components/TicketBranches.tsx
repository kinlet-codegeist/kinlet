import { useEffect, useRef, useState } from "react";
import {
  orderedRevisions,
  branchHeads,
  type BranchDraft,
  type BranchHistory,
  type BranchRevision,
  type BranchStore,
} from "../platform/ticket-branches";
import { sameText, type TicketText } from "../platform/jira-checkpoints";
import { type CheckpointChoice, FieldDifference } from "./CheckpointComparison";
import { Button, Dialog } from "./ui";
import { BranchPublication } from "./BranchPublication";
import { BranchPublicationHistory } from "./BranchPublicationHistory";

type Wording = TicketText & { name: string };
type Editor = Wording & { parent: BranchRevision | null; newBranch: boolean };
type Props = {
  ticketKey: string;
  choices: CheckpointChoice[];
  selectedId?: string;
  store: BranchStore;
  sampleDraft?: Wording;
};

export function TicketBranches(props: Props) {
  const [id, setId] = useState("");
  if (!props.choices.length) return null;
  const choice = props.choices.find((item) => item.id === id);
  return (
    <>
      <Button
        size="small"
        onClick={() => setId(props.selectedId || props.choices[0].id)}
      >
        Ticket branches
      </Button>
      {choice && (
        <BranchWorkspace
          key={choice.id}
          {...props}
          choice={choice}
          selectCheckpoint={setId}
          onClose={() => setId("")}
        />
      )}
    </>
  );
}

function BranchWorkspace({
  ticketKey,
  choices,
  store,
  choice,
  selectCheckpoint,
  onClose,
  sampleDraft,
}: Props & {
  choice: CheckpointChoice;
  selectCheckpoint: (id: string) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<{
    base: Awaited<ReturnType<CheckpointChoice["read"]>>;
    history: BranchHistory;
  }>();
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [editor, setEditor] = useState<Editor>();
  const [publication, setPublication] = useState<{
    revision: BranchRevision;
    view: "review" | "history";
  }>();
  const [saving, setSaving] = useState(false);
  const [discard, setDiscard] = useState<"close" | "list" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingId = useRef("");
  const writing = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setData(undefined);
    setError("");
    Promise.all([choice.read(), store.list(choice.id, controller.signal)]).then(
      ([base, history]) => {
        if (!controller.signal.aborted) setData({ base, history });
      },
      (err) => {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error
              ? err.message
              : "Couldn’t load this checkpoint’s branches.",
          );
      },
    );
    return () => controller.abort();
  }, [choice, store, reload]);

  const revisions = data?.history.revisions ?? [];
  const heads = branchHeads(revisions);
  const headIds = new Set(heads.map((r) => r.revisionId));
  const branches = new Map<string, BranchRevision>();
  for (const head of heads)
    if (!branches.has(head.branchId)) branches.set(head.branchId, head);
  const selected =
    revisions.find((r) => r.revisionId === selectedId) ?? heads[0];
  const history = revisions.filter((r) => r.branchId === selected?.branchId);
  const multipleHeads =
    heads.filter((r) => r.branchId === selected?.branchId).length > 1;
  const base = data?.base;

  function start(parent: BranchRevision | null, newBranch: boolean) {
    if (!base) return;
    const source = parent ?? base;
    setEditor({
      name: newBranch ? "" : parent!.name,
      summary: source.summary,
      description: source.description,
      parent,
      newBranch,
    });
    setError("");
    setNotice("");
    setDiscard(null);
    pendingId.current = "";
  }
  function revise(changes: Partial<Wording>) {
    if (!editor || writing.current) return;
    setEditor({ ...editor, ...changes });
    setError("");
    pendingId.current = "";
  }
  function leave(target: "list" | "close") {
    if (writing.current) return;
    if (
      editor &&
      (editor.name !== (editor.newBranch ? "" : editor.parent?.name) ||
        !sameText(editor, editor.parent ?? base!))
    ) {
      setDiscard(target);
    } else if (target === "close") onClose();
    else cancel();
  }
  function cancel() {
    setEditor(undefined);
    setDiscard(null);
    setError("");
    pendingId.current = "";
  }
  async function save() {
    if (
      !editor ||
      !editor.name.trim() ||
      !editor.summary.trim() ||
      writing.current
    )
      return;
    writing.current = true;
    setSaving(true);
    setError("");
    const revisionId = pendingId.current || crypto.randomUUID();
    pendingId.current = revisionId;
    const draft: BranchDraft = {
      name: editor.name.trim(),
      summary: editor.summary,
      description: editor.description,
      branchId: editor.newBranch ? revisionId : editor.parent!.branchId,
      parentId: editor.parent?.revisionId ?? null,
      revisionId,
      checkpointId: choice.id,
    };
    try {
      const revision = await store.save(draft);
      setSelectedId(revision.revisionId);
      setNotice("Draft saved to “" + revision.name + "”.");
      setData(
        (previous) =>
          previous && {
            ...previous,
            history: {
              ...previous.history,
              revisions: orderedRevisions([
                revision,
                ...previous.history.revisions.filter(
                  (r) => r.revisionId !== revision.revisionId,
                ),
              ]),
            },
          },
      );
      cancel();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn’t confirm the save. Try again.",
      );
    } finally {
      writing.current = false;
      setSaving(false);
    }
  }
  const labelRevision = (r: BranchRevision) =>
    new Date(r.created).toLocaleString() +
    " · " +
    r.author +
    " · " +
    r.revisionId.slice(0, 8);
  if (publication?.view === "history")
    return (
      <BranchPublicationHistory
        store={store}
        revision={publication.revision}
        ticketKey={ticketKey}
        sample={!!sampleDraft}
        onClose={() => setPublication(undefined)}
        onReview={() => setPublication({ ...publication, view: "review" })}
      />
    );
  if (publication)
    return (
      <BranchPublication
        store={store}
        revision={publication.revision}
        ticketKey={ticketKey}
        sample={!!sampleDraft}
        onHistory={() => setPublication({ ...publication, view: "history" })}
        onClose={() => setPublication(undefined)}
      />
    );
  return (
    <Dialog
      title={
        editor
          ? editor.newBranch
            ? "New ticket branch"
            : "Edit draft"
          : "Ticket branches"
      }
      subtitle={ticketKey + (sampleDraft ? " · Sample ticket" : "")}
      wide
      onClose={() => leave("close")}
      footer={
        discard ? (
          <>
            <Button onClick={() => setDiscard(null)}>Keep editing</Button>
            <Button onClick={discard === "close" ? onClose : cancel}>
              Discard changes
            </Button>
          </>
        ) : editor ? (
          <>
            <Button disabled={saving} onClick={() => leave("list")}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={
                saving ||
                !editor.name.trim() ||
                !editor.summary.trim() ||
                (!editor.newBranch &&
                  !!editor.parent &&
                  sameText(editor, editor.parent))
              }
              onClick={() => void save()}
            >
              {saving ? "Saving draft…" : "Save draft"}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Done</Button>
        )
      }
    >
      <div className="ticket-branches">
        <label className="live-select">
          Source checkpoint
          <select
            value={choice.id}
            disabled={!!editor}
            onChange={(e) => selectCheckpoint(e.target.value)}
          >
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {base?.plan && (
          <p className="review-note">
            Linked plan · Page {base.plan.id} · v{base.plan.version}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
        {!data &&
          (error ? (
            <Button size="small" onClick={() => setReload((n) => n + 1)}>
              Try again
            </Button>
          ) : (
            <p role="status">Reading saved drafts…</p>
          ))}
        {discard && <p role="alert">Discard your unsaved wording?</p>}
        {data &&
          (editor ? (
            <fieldset className="branch-fields" disabled={saving || !!discard}>
              <label>
                Branch name
                <input
                  maxLength={80}
                  value={editor.name}
                  readOnly={!editor.newBranch}
                  onChange={(e) => revise({ name: e.target.value })}
                />
              </label>
              <label>
                Draft summary
                <input
                  value={editor.summary}
                  onChange={(e) => revise({ summary: e.target.value })}
                />
              </label>
              <label>
                Draft description
                <textarea
                  rows={8}
                  value={editor.description}
                  onChange={(e) => revise({ description: e.target.value })}
                />
              </label>
              {editor.parent && (
                <p className="review-note">
                  Based on revision {editor.parent.revisionId.slice(0, 8)} of “
                  {editor.parent.name}”.
                </p>
              )}
              {sampleDraft && editor.newBranch && !editor.parent && (
                <Button size="small" onClick={() => revise(sampleDraft)}>
                  Use guest checkout draft
                </Button>
              )}
              {error && !editor.newBranch && (
                <Button
                  size="small"
                  onClick={() => {
                    setEditor({ ...editor, newBranch: true, name: "" });
                    setError("");
                    pendingId.current = "";
                  }}
                >
                  Keep wording in a new branch
                </Button>
              )}
              <p className="review-note">
                {sampleDraft
                  ? "This draft belongs to the checkout example."
                  : "Saving adds a draft attachment to this Jira ticket."}
              </p>
            </fieldset>
          ) : (
            <>
              <div className="live-heading-actions">
                <Button variant="primary" onClick={() => start(null, true)}>
                  New branch from checkpoint
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    setNotice("");
                    setReload((n) => n + 1);
                  }}
                >
                  Refresh drafts
                </Button>
              </div>
              {data.history.unavailable > 0 && (
                <p role="status">Some draft attachments could not be read.</p>
              )}
              {selected ? (
                <>
                  <div className="checkpoint-selectors">
                    <label className="live-select">
                      Branch
                      <select
                        value={selected.branchId}
                        onChange={(e) =>
                          setSelectedId(
                            branches.get(e.target.value)!.revisionId,
                          )
                        }
                      >
                        {[...branches.values()].map((r) => (
                          <option key={r.branchId} value={r.branchId}>
                            {r.name} · {r.branchId.slice(0, 8)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="live-select">
                      Saved revision
                      <select
                        value={selected.revisionId}
                        onChange={(e) => setSelectedId(e.target.value)}
                      >
                        {history.map((r) => (
                          <option key={r.revisionId} value={r.revisionId}>
                            {labelRevision(r)}
                            {multipleHeads && headIds.has(r.revisionId)
                              ? " · Parallel draft"
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {multipleHeads && (
                    <p role="status">
                      Two or more edits were saved in parallel. Select a
                      revision to continue from its wording.
                    </p>
                  )}
                  {selected.parentId && (
                    <p className="review-note">
                      Based on revision {selected.parentId.slice(0, 8)}.
                    </p>
                  )}
                  <div className="live-heading-actions">
                    <Button
                      variant="primary"
                      onClick={() =>
                        setPublication({ revision: selected, view: "review" })
                      }
                    >
                      Review branch changes
                    </Button>
                    <Button
                      onClick={() =>
                        setPublication({ revision: selected, view: "history" })
                      }
                    >
                      Publication history
                    </Button>
                    {headIds.has(selected.revisionId) && (
                      <Button onClick={() => start(selected, false)}>
                        Edit draft
                      </Button>
                    )}
                    <Button onClick={() => start(selected, true)}>
                      New branch from revision
                    </Button>
                  </div>
                  <div className="checkpoint-differences">
                    <FieldDifference
                      label="Summary changes from checkpoint"
                      before={data.base.summary}
                      after={selected.summary}
                      earlierLabel="Source checkpoint"
                      laterLabel="Saved draft"
                    />
                    <FieldDifference
                      label="Description changes from checkpoint"
                      before={data.base.description}
                      after={selected.description}
                      earlierLabel="Source checkpoint"
                      laterLabel="Saved draft"
                    />
                  </div>
                </>
              ) : (
                <p>
                  {data.history.unavailable
                    ? "No readable drafts for this checkpoint."
                    : "No branches saved from this checkpoint yet."}
                </p>
              )}
            </>
          ))}
      </div>
    </Dialog>
  );
}

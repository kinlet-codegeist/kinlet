import { useEffect, useRef, useState } from "react";
import {
  readHandoffEvidence,
  handoffText,
  type HandoffPreview,
  type HandoffSource,
} from "../platform/decision-handoff";
import {
  proposalFields,
  returnInstructions,
} from "../platform/returned-proposal";
import { runtime } from "../platform/runtime";
import { downloadJson } from "../platform/download";
import type { DecisionEntry } from "../platform/review-decisions";
import { Button, Dialog } from "./ui";

export function DecisionHandoff({
  source,
  entry,
  onClose,
}: {
  source: HandoffSource;
  entry: DecisionEntry;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<HandoffPreview | null>(null);
  const [nextTask, setNextTask] = useState("");
  const [previewFormat, setPreviewFormat] = useState("text");
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const operation = useRef(0);
  const textArea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const id = ++operation.current;
    setBusy(true);
    setPreview(null);
    setError("");
    setNotice("");
    readHandoffEvidence(source, entry)
      .then((evidence) => {
        if (operation.current === id)
          setPreview({ evidence, checkedAt: new Date().toISOString() });
      })
      .catch((err: unknown) => {
        if (operation.current === id)
          setError(
            err instanceof Error ? err.message : "Couldn’t read the review.",
          );
      })
      .finally(() => {
        if (operation.current === id) setBusy(false);
      });
    return () => {
      operation.current++;
    };
  }, [source, entry, refresh]);

  const handoffDocument = preview && {
    format: "kinlet.decision-handoff.v1",
    checkedAt: preview.checkedAt,
    nextTask: nextTask.trim() || null,
    ...preview.evidence,
    siteId: source.kind === "jira" ? runtime.cloudId : null,
    returnInstructions,
    proposal: proposalFields,
  };
  const text = !preview
    ? ""
    : previewFormat === "json"
      ? JSON.stringify(handoffDocument, null, 2)
      : handoffText(preview, nextTask);
  async function deliver(format: "text" | "json") {
    if (!preview || busy) return;
    const id = ++operation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const fresh = await readHandoffEvidence(source, entry);
      if (operation.current !== id) return;
      if (JSON.stringify(fresh) !== JSON.stringify(preview.evidence)) {
        setPreview({ evidence: fresh, checkedAt: new Date().toISOString() });
        setNotice(
          "The sources changed. Review the updated handoff before sharing it.",
        );
        return;
      }
      if (format === "json") {
        downloadJson(
          source.key + "-review-" + entry.id + ".json",
          handoffDocument,
        );
        setNotice("JSON download requested.");
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        if (operation.current === id) setNotice("Handoff copied.");
      } catch {
        if (operation.current !== id) return;
        textArea.current?.focus();
        textArea.current?.select();
        setNotice(
          "The browser couldn’t copy automatically. Copy the selected handoff text.",
        );
      }
    } catch (err) {
      if (operation.current === id) {
        setPreview(null);
        setError(
          err instanceof Error
            ? err.message
            : "Couldn’t verify the review. Try refreshing the sources.",
        );
      }
    } finally {
      if (operation.current === id) setBusy(false);
    }
  }
  return (
    <Dialog
      title="Decision handoff"
      subtitle={
        source.key +
        " · Reviewed plan v" +
        entry.version +
        (source.kind === "sample" ? " · Sample ticket" : "")
      }
      onClose={onClose}
      wide
      footer={
        <>
          <Button
            disabled={busy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh sources
          </Button>
          <Button
            disabled={busy || !preview}
            onClick={() => void deliver("json")}
          >
            Download JSON
          </Button>
          <Button
            disabled={busy || !preview}
            variant="primary"
            onClick={() => void deliver("text")}
          >
            {previewFormat === "json" ? "Copy JSON" : "Copy handoff"}
          </Button>
        </>
      }
    >
      <div className="decision-handoff">
        {busy && <p role="status">Checking sources…</p>}
        {error && <p role="alert">{error}</p>}
        {preview && (
          <>
            {preview.evidence.plan.current &&
              preview.evidence.plan.current.version > entry.version && (
                <p className="handoff-plan-change">
                  This decision covered v{entry.version}. The plan is now at v
                  {preview.evidence.plan.current.version}.
                </p>
              )}
            <label>
              Next task (optional)
              <textarea
                rows={2}
                value={nextTask}
                disabled={busy}
                maxLength={2000}
                onChange={(event) => {
                  setNextTask(event.target.value);
                  setNotice("");
                }}
              />
            </label>
            <label>
              Preview format
              <select
                disabled={busy}
                value={previewFormat}
                onChange={(event) => {
                  setPreviewFormat(event.target.value);
                  setNotice("");
                }}
              >
                <option value="text">Plain text</option>
                <option value="json">JSON</option>
              </select>
            </label>
            <label>
              Handoff preview
              <textarea
                ref={textArea}
                className="handoff-preview"
                readOnly
                rows={12}
                value={text}
              />
            </label>
          </>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
    </Dialog>
  );
}

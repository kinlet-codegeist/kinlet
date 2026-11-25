import { createHash } from "node:crypto";
import {
  type Checkpoint,
  type SourceRef,
  sourceKey,
} from "../domain/workspace";
import { captureSource, fitsWorkspace } from "./workspace-sources";
import { saveCapturedCheckpoint, type Actor } from "./workspace-resolver";
import { workspacePayloadBytes } from "./workspace-store";

// Leave substantial headroom for existing workspace data and in-flight writes.
const automaticHistoryBudget = 64 * 1024 * 1024;

// A native source version has one stable identifier per project. This makes
// event redelivery and reconciliation retries safe without suppressing a
// later version that happens to restore an earlier piece of text.
export function automaticCheckpointId(source: SourceRef, version: string) {
  const hex = createHash("sha256")
    .update(JSON.stringify([source.kind, source.id, version]))
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Capture one readable source version as a regular, immutable checkpoint. */
export async function captureAutomaticSource(actor: Actor, source: SourceRef) {
  const version = await captureSource(actor.client, actor.project, source);
  if (!fitsWorkspace(version))
    throw new Error(
      "A source is too large to capture; its previous history remains available.",
    );
  const id = automaticCheckpointId(source, version.version);
  const existing = await actor.store.get<Checkpoint>("checkpoint", id);
  if (existing) {
    if (
      existing.data.sources.length !== 1 ||
      sourceKey(existing.data.sources[0]) !== sourceKey(source)
    )
      throw new Error(
        "An automatic capture conflicts with an existing checkpoint.",
      );
    if (existing.data.finishedAt) return { id, created: false };
    if (existing.data.author !== actor.id)
      throw new Error(
        "An unfinished automatic capture requires its original tracking account.",
      );
  }
  if (
    !existing &&
    (await workspacePayloadBytes()) +
      Buffer.byteLength(JSON.stringify(version), "utf8") >
      automaticHistoryBudget
  )
    throw new Error(
      "Automatic history reached its storage safety limit. Tracking cannot save new versions until workspace storage is reduced.",
    );
  await saveCapturedCheckpoint(
    actor,
    id,
    `Automatic ${source.kind === "jira" ? "Jira" : "Confluence"} capture`,
    [version],
  );
  return { id, created: !existing };
}

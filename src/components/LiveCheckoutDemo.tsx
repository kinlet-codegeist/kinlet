import { useState } from "react";
import { Link } from "react-router-dom";
import { parsePageId } from "../platform/confluence-plan";
import { runtime } from "../platform/runtime";
import { workspaceRequest } from "../platform/workspace";
import { Button } from "./ui";
import {
  workspaceMessage,
  WorkspaceProposalReview,
  WorkspaceReceipt,
} from "./WorkspaceWork";

type DemoStatus = {
  proposalId?: string;
  ticketKey?: string;
  policyChanged?: boolean;
  retryApplied?: boolean;
  repaired?: boolean;
};

type DemoRun = { id: string; pageId?: string };

function savedRun(key: string): DemoRun | undefined {
  const value = localStorage.getItem(key);
  if (!value) return;
  try {
    return JSON.parse(value) as DemoRun;
  } catch {
    return { id: value };
  }
}

export function LiveCheckoutDemo({
  onBranch,
  onCheckpoint,
}: {
  onBranch: (id: string) => Promise<void>;
  onCheckpoint: (id: string) => Promise<void>;
}) {
  const key = [
    "kinlet.checkout-demo",
    runtime.cloudId,
    runtime.projectId,
    runtime.accountId,
  ].join(".");
  const [run, setRun] = useState(() => savedRun(key));
  const requestId = run?.id ?? "";
  const [mode, setMode] = useState(run?.pageId ? "confluence" : "jira");
  const [page, setPage] = useState(run?.pageId ?? "");
  const [status, setStatus] = useState<DemoStatus>();
  const [opened, setOpened] = useState<{
    kind: "proposal" | "receipt";
    id: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh(id = requestId) {
    const next = await workspaceRequest<DemoStatus>("checkoutDemoStatus", {
      requestId: id,
    });
    setStatus(next);
    return next;
  }

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err) {
      setError(workspaceMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id="live-checkout-demo"
      className="card padded-card workspace-card"
    >
      <h2>Try with real Jira records</h2>
      <p>
        Review a checkout draft after its policy changes. The demo creates
        clearly named sample records in {runtime.projectKey ?? "this project"}.
      </p>
      {!status?.proposalId && (
        <details open={requestId ? true : undefined}>
          <summary>Set up the live checkout demo</summary>
          <form
            className="workspace-form"
            onSubmit={(event) => {
              event.preventDefault();
              void act(async () => {
                const activeRun = run ?? {
                  id: crypto.randomUUID(),
                  pageId: mode === "confluence" ? parsePageId(page) : undefined,
                };
                localStorage.setItem(key, JSON.stringify(activeRun));
                setRun(activeRun);
                await workspaceRequest("setupCheckoutDemo", {
                  requestId: activeRun.id,
                  confirmed: true,
                  pageId: activeRun.pageId,
                });
                await refresh(activeRun.id);
              });
            }}
          >
            <label>
              Policy source
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value)}
                disabled={busy || !!run}
              >
                <option value="jira">A new Jira policy ticket</option>
                <option value="confluence">
                  A new Confluence page (requires Confluence)
                </option>
              </select>
            </label>
            {mode === "confluence" && (
              <label>
                Existing page in the destination demo space
                <input
                  required
                  value={page}
                  onChange={(event) => setPage(event.target.value)}
                  disabled={busy || !!run}
                />
              </label>
            )}
            <p>
              A checkout test ticket will be created in{" "}
              {runtime.projectKey ?? "this project"}, together with{" "}
              {mode === "jira"
                ? "a separate Jira policy ticket"
                : "a new page in the chosen Confluence space"}
              .
            </p>
            <Button type="submit" disabled={busy}>
              {requestId
                ? "Check progress"
                : "Confirm and create sample records"}
            </Button>
          </form>
        </details>
      )}
      {status?.proposalId && (
        <>
          <ol>
            <li>Publish the sample policy change to allow guest checkout.</li>
            <li>
              Review the proposal, approve only Wording, then apply that
              approved edit.
            </li>
            <li>
              Prepare the sample repair and review the new title. Approve and
              apply it.
            </li>
            <li>Open the sample Jira ticket and inspect Activity → History.</li>
          </ol>
          <div className="live-heading-actions">
            <Button
              disabled={busy || status.policyChanged}
              onClick={() =>
                void act(async () => {
                  await workspaceRequest("changeCheckoutDemoPolicy", {
                    requestId,
                  });
                  await refresh();
                })
              }
            >
              Publish sample policy change
            </Button>
            <Button
              disabled={busy || !status.policyChanged}
              onClick={() =>
                setOpened({ kind: "proposal", id: status.proposalId! })
              }
            >
              Review checkout edits
            </Button>
            <Button
              disabled={busy || !status.retryApplied || status.repaired}
              onClick={() =>
                void act(async () => {
                  const result = await workspaceRequest<{ id: string }>(
                    "prepareCheckoutDemoRepair",
                    { requestId },
                  );
                  setOpened({ kind: "proposal", id: result.id });
                })
              }
            >
              Prepare sample repair
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await refresh();
                })
              }
            >
              Check progress
            </Button>
          </div>
          {status.retryApplied && <p>The payment retry wording is in Jira.</p>}
          {status.repaired && <p>The repaired checkout title is in Jira.</p>}
          {status.ticketKey && runtime.siteUrl && (
            <p>
              <a
                target="_blank"
                rel="noreferrer"
                href={
                  new URL(
                    "/browse/" + encodeURIComponent(status.ticketKey),
                    runtime.siteUrl,
                  ).href
                }
              >
                Open {status.ticketKey} in Jira
              </a>
            </p>
          )}
          {opened?.kind === "proposal" && (
            <WorkspaceProposalReview
              key={opened.id}
              id={opened.id}
              onBranch={onBranch}
              onApproved={async (id) => setOpened({ kind: "receipt", id })}
            />
          )}
          {opened?.kind === "receipt" && (
            <WorkspaceReceipt
              key={opened.id}
              id={opened.id}
              onApplied={() => refresh().then(() => {})}
              onBranch={onBranch}
              onCheckpoint={onCheckpoint}
              onReview={(id) => setOpened({ kind: "proposal", id })}
            />
          )}
        </>
      )}
      {busy && <p role="status">Checking the live demo…</p>}
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
      {requestId && (
        <Button
          disabled={busy}
          onClick={() => {
            localStorage.removeItem(key);
            setRun(undefined);
            setMode("jira");
            setPage("");
            setStatus(undefined);
            setOpened(undefined);
            setError("");
          }}
        >
          Start a separate sample run
        </Button>
      )}
      <p>
        <Link to="/jira?example=checkout">
          Open the built-in checkout example
        </Link>
      </p>
    </section>
  );
}

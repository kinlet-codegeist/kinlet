import { useState } from "react";
import { ClipboardCheck, FileText } from "lucide-react";
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
  const [useConfluence, setUseConfluence] = useState(!!run?.pageId);
  const [page, setPage] = useState(run?.pageId ?? "");
  const [status, setStatus] = useState<DemoStatus>();
  const [opened, setOpened] = useState<{
    kind: "proposal" | "receipt";
    id: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const proposalId = status?.proposalId;
  const ticketUrl =
    status?.ticketKey && runtime.siteUrl
      ? new URL(
          "/browse/" + encodeURIComponent(status.ticketKey),
          runtime.siteUrl,
        ).href
      : undefined;
  const createLabel = useConfluence
    ? "Create a practice ticket and page"
    : "Create two practice tickets";

  async function refresh(id = requestId) {
    const next = await workspaceRequest<DemoStatus>("checkoutDemoStatus", {
      requestId: id,
    });
    setStatus(next);
  }

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err) {
      setError(
        workspaceMessage(err).replace(
          /^There was an error invoking the function - /,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function startNewRun() {
    localStorage.removeItem(key);
    setRun(undefined);
    setUseConfluence(false);
    setPage("");
    setStatus(undefined);
    setOpened(undefined);
    setError("");
  }

  return (
    <section
      id="live-checkout-demo"
      className="card padded-card workspace-card checkout-practice"
      aria-labelledby="checkout-practice-title"
    >
      <header className="checkout-practice-heading">
        <h2 id="checkout-practice-title">
          Practice reviewing a checkout change
        </h2>
        <p>
          Your team is testing checkout for an online store. When the store
          starts allowing shoppers to pay as guests, you’ll review two suggested
          changes and decide which one still makes sense.
        </p>
      </header>

      {!proposalId && (
        <form
          className="workspace-form checkout-practice-setup"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              const activeRun = run ?? {
                id: crypto.randomUUID(),
                pageId: useConfluence ? parsePageId(page) : undefined,
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
          <div className="checkout-practice-tickets">
            <div className="checkout-practice-ticket">
              <ClipboardCheck size={20} aria-hidden="true" />
              <div>
                <h3>Checkout task</h3>
                <p>
                  A sample Jira ticket that receives the changes you approve.
                </p>
              </div>
            </div>
            <div className="checkout-practice-ticket">
              <FileText size={20} aria-hidden="true" />
              <div>
                <h3>Checkout rules</h3>
                <p>
                  {useConfluence ? "A Confluence page" : "A second Jira ticket"}{" "}
                  with the rule that shoppers must sign in before paying.
                </p>
              </div>
            </div>
          </div>
          <p className="muted">
            Kinlet adds {useConfluence ? "the practice task" : "both tickets"}{" "}
            to this Jira project
            {runtime.projectKey && <> ({runtime.projectKey})</>}. Your existing
            tickets stay as they are.
          </p>
          <div className="checkout-practice-actions">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy
                ? "Setting up practice…"
                : run
                  ? "Continue setup"
                  : createLabel}
            </Button>
            <Link className="text-link" to="/jira?example=checkout">
              Preview without creating tickets
            </Link>
          </div>
          {!run && (
            <details className="checkout-practice-options">
              <summary>Use Confluence for the checkout rules</summary>
              <label className="workspace-checkbox">
                <input
                  type="checkbox"
                  checked={useConfluence}
                  onChange={(event) => setUseConfluence(event.target.checked)}
                />
                Save the rules to a new Confluence page
              </label>
              {useConfluence && (
                <label>
                  Link or ID of a page in your practice space
                  <input
                    required
                    value={page}
                    onChange={(event) => setPage(event.target.value)}
                  />
                  <small>
                    Kinlet creates a separate page in the same space.
                  </small>
                </label>
              )}
            </details>
          )}
          {run && !busy && (
            <p className="muted">
              If Jira asked for access, return here after allowing it. Continue
              setup to check for tickets from this run.
            </p>
          )}
        </form>
      )}

      {status && proposalId && (
        <>
          <section className="checkout-practice-step" aria-live="polite">
            {!status.policyChanged && (
              <>
                <h3>Let shoppers pay as guests</h3>
                <p>
                  The rule currently says shoppers must sign in. Update the
                  practice rule to allow guest checkout, then review the
                  suggestions written under the old rule.
                </p>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await workspaceRequest("changeCheckoutDemoPolicy", {
                        requestId,
                      });
                      await refresh();
                    })
                  }
                >
                  Allow guest checkout
                </Button>
              </>
            )}
            {status.policyChanged && !status.retryApplied && (
              <>
                <h3>Decide what to keep</h3>
                <p>
                  The sign-in title needs to change. The payment retry check
                  still applies. Review both suggestions, then approve and apply
                  the retry check.
                </p>
                {!opened && (
                  <Button
                    variant="primary"
                    onClick={() =>
                      setOpened({ kind: "proposal", id: proposalId })
                    }
                  >
                    Review the two suggestions
                  </Button>
                )}
              </>
            )}
            {status.policyChanged &&
              status.retryApplied &&
              !status.repaired && (
                <>
                  <h3>Update the checkout title</h3>
                  <p>
                    You saved the retry check in Jira. Review a replacement
                    title that uses the new guest checkout rule.
                  </p>
                  <div className="checkout-practice-actions">
                    <Button
                      variant="primary"
                      disabled={busy}
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
                      Review the new title
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        setOpened({ kind: "proposal", id: proposalId })
                      }
                    >
                      See the original suggestions
                    </Button>
                  </div>
                </>
              )}
            {status.policyChanged && status.retryApplied && status.repaired && (
              <>
                <h3>Check your work in Jira</h3>
                <p>
                  Open the checkout task and choose{" "}
                  <strong>Activity → History</strong>. Look for the description
                  update that adds the retry check and the title update to
                  “Verify guest checkout.”
                </p>
              </>
            )}
          </section>

          {opened?.kind === "proposal" && (
            <WorkspaceProposalReview
              key={opened.id}
              id={opened.id}
              practice
              onBranch={onBranch}
              onApproved={async (id) => setOpened({ kind: "receipt", id })}
            />
          )}
          {opened?.kind === "receipt" && (
            <WorkspaceReceipt
              key={opened.id}
              id={opened.id}
              practice
              onApplied={refresh}
              onBranch={onBranch}
              onCheckpoint={onCheckpoint}
              onReview={(id) => setOpened({ kind: "proposal", id })}
            />
          )}

          <div className="checkout-practice-actions">
            {ticketUrl && (
              <a
                className="text-link"
                target="_blank"
                rel="noreferrer"
                href={ticketUrl}
              >
                Open the checkout task in Jira ({status.ticketKey})
              </a>
            )}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void act(() => refresh())}
            >
              Check progress
            </Button>
          </div>
        </>
      )}

      {busy && proposalId && <p role="status">Updating your practice run…</p>}
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
      {run && (
        <Button
          className="checkout-practice-reset"
          variant="ghost"
          disabled={busy}
          onClick={startNewRun}
        >
          Start a new practice run
        </Button>
      )}
    </section>
  );
}

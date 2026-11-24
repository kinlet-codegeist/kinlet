import { useEffect, useMemo, useState } from "react";
import { compareWording } from "../domain/plan-diff";
import {
  readPinnedPlan,
  type PlanReference,
  type PlanVersion,
} from "../platform/confluence-plan";
import type { TicketText } from "../platform/jira-checkpoints";
import { PassageChanges } from "./PlanComparison";
import { Button, Dialog } from "./ui";

type Capture = TicketText & { plan?: PlanReference };
export type CheckpointChoice = {
  id: string;
  label: string;
  read: () => Capture | Promise<Capture>;
};
type ReadPlan = (ref: PlanReference) => Promise<PlanVersion>;

export function FieldDifference({
  label,
  before,
  after,
  earlierLabel = "Earlier checkpoint",
  laterLabel = "Later checkpoint",
}: {
  label: string;
  before: string;
  after: string;
  earlierLabel?: string;
  laterLabel?: string;
}) {
  const diff = useMemo(() => compareWording(before, after), [before, after]);
  const same = before === after;
  return (
    <section>
      <h3>{label}</h3>
      {same ? (
        <p>{before ? "Unchanged." : "Both values are empty."}</p>
      ) : diff.groups.length ? (
        <PassageChanges groups={diff.groups} />
      ) : (
        <p>
          {diff.fullText
            ? "Compare the full text below."
            : "Spacing or line breaks changed."}
        </p>
      )}
      {(before || after) && (
        <details open={diff.fullText || undefined}>
          <summary>
            {same ? "Show saved text" : "Show both saved texts"}
          </summary>
          <div className="proposal-passages">
            <section>
              <h4>{same ? "Saved text" : earlierLabel}</h4>
              <p>{before || "(Empty)"}</p>
            </section>
            {!same && (
              <section>
                <h4>{laterLabel}</h4>
                <p>{after || "(Empty)"}</p>
              </section>
            )}
          </div>
        </details>
      )}
    </section>
  );
}

function PlanAtCheckpoints({
  before,
  after,
  readPlan,
}: {
  before?: PlanReference;
  after?: PlanReference;
  readPlan: ReadPlan;
}) {
  const [versions, setVersions] = useState<[PlanVersion, PlanVersion]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!before || !after || busy) return;
    setBusy(true);
    setError("");
    try {
      setVersions(await Promise.all([readPlan(before), readPlan(after)]));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn’t load the saved page versions.",
      );
    } finally {
      setBusy(false);
    }
  }
  const reference = (ref?: PlanReference) =>
    ref ? "Page " + ref.id + " · v" + ref.version : "No linked page";
  return (
    <section>
      <h3>Linked Confluence plan</h3>
      {!before && !after ? (
        <p>Neither checkpoint includes a plan.</p>
      ) : before &&
        after &&
        before.id === after.id &&
        before.cloudId === after.cloudId ? (
        <>
          <p>
            {before.version === after.version
              ? "Both checkpoints pin " + reference(before) + "."
              : "Page " +
                before.id +
                " · v" +
                before.version +
                " → v" +
                after.version}
          </p>
          {before.version !== after.version && !versions && (
            <Button size="small" disabled={busy} onClick={() => void load()}>
              {busy
                ? "Loading page versions…"
                : error
                  ? "Retry plan comparison"
                  : "Compare plan wording"}
            </Button>
          )}
        </>
      ) : (
        <dl className="checkpoint-plan-refs">
          <dt>Earlier checkpoint</dt>
          <dd>{reference(before)}</dd>
          <dt>Later checkpoint</dt>
          <dd>{reference(after)}</dd>
        </dl>
      )}
      {error && <p role="alert">{error}</p>}
      {versions && (
        <>
          <p>
            {versions[0].title === versions[1].title
              ? versions[1].title
              : versions[0].title + " → " + versions[1].title}
          </p>
          <FieldDifference
            label="Page wording"
            before={versions[0].text}
            after={versions[1].text}
          />
        </>
      )}
    </section>
  );
}

function SavedComparison({
  earlier,
  later,
  readPlan,
}: {
  earlier: CheckpointChoice;
  later: CheckpointChoice;
  readPlan: ReadPlan;
}) {
  const [pair, setPair] = useState<[Capture, Capture]>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([earlier.read(), later.read()]).then(
      (loaded) => {
        if (active) setPair(loaded);
      },
      (err) => {
        if (active)
          setError(
            err instanceof Error
              ? err.message
              : "Couldn’t read the selected checkpoints.",
          );
      },
    );
    return () => {
      active = false;
    };
  }, [earlier, later, attempt]);
  if (error)
    return (
      <div>
        <p role="alert">{error}</p>
        <Button
          size="small"
          onClick={() => {
            setError("");
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  if (!pair) return <p role="status">Reading the two saved checkpoints…</p>;
  const [before, after] = pair;
  return (
    <div className="checkpoint-differences">
      <FieldDifference
        label="Ticket summary"
        before={before.summary}
        after={after.summary}
      />
      <FieldDifference
        label="Ticket description"
        before={before.description}
        after={after.description}
      />
      <PlanAtCheckpoints
        before={before.plan}
        after={after.plan}
        readPlan={readPlan}
      />
    </div>
  );
}

// Choices arrive newest first. Keep the two saves in chronological order.
export function CheckpointComparison({
  ticketKey,
  choices,
  selectedId,
  readPlan = readPinnedPlan,
  sample,
}: {
  ticketKey: string;
  choices: CheckpointChoice[];
  selectedId?: string;
  readPlan?: ReadPlan;
  sample?: boolean;
}) {
  const [pair, setPair] = useState<{ earlier: string; later: string }>();
  if (!choices.length) return null;
  if (choices.length === 1)
    return (
      <p className="review-note">
        Save another checkpoint to compare two saved versions.
      </p>
    );
  const earlier = choices.find((item) => item.id === pair?.earlier);
  const later = choices.find((item) => item.id === pair?.later);
  function open() {
    const index = Math.max(
      0,
      choices.findIndex((item) => item.id === selectedId),
    );
    const laterIndex = Math.min(index, choices.length - 2);
    setPair({
      earlier: choices[laterIndex + 1].id,
      later: choices[laterIndex].id,
    });
  }
  return (
    <>
      <Button size="small" onClick={open}>
        Compare checkpoints
      </Button>
      {earlier && later && (
        <Dialog
          title="Compare checkpoints"
          subtitle={ticketKey + (sample ? " · Sample ticket" : "")}
          wide
          onClose={() => setPair(undefined)}
          footer={<Button onClick={() => setPair(undefined)}>Done</Button>}
        >
          <div className="checkpoint-selectors">
            <label className="live-select">
              Earlier checkpoint
              <select
                value={earlier.id}
                onChange={(e) => {
                  const index = choices.findIndex(
                    (item) => item.id === e.target.value,
                  );
                  setPair({
                    earlier: choices[index].id,
                    later:
                      choices.indexOf(later) < index
                        ? later.id
                        : choices[index - 1].id,
                  });
                }}
              >
                {choices.slice(1).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="live-select">
              Later checkpoint
              <select
                value={later.id}
                onChange={(e) => {
                  const index = choices.findIndex(
                    (item) => item.id === e.target.value,
                  );
                  setPair({
                    earlier:
                      choices.indexOf(earlier) > index
                        ? earlier.id
                        : choices[index + 1].id,
                    later: choices[index].id,
                  });
                }}
              >
                {choices.slice(0, -1).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <SavedComparison
            key={earlier.id + "/" + later.id}
            earlier={earlier}
            later={later}
            readPlan={readPlan}
          />
        </Dialog>
      )}
    </>
  );
}

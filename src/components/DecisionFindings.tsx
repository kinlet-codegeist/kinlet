import type { DecisionFinding } from "../domain/decision-impact";
import { runtime } from "../platform/runtime";
import { Badge } from "./ui";

const statusLabel = {
  update: "Update wording",
  matches: "Matches option",
  keep: "Keep this check",
  confirm: "Needs clarification",
} as const;

export function DecisionFindings({
  findings,
}: {
  findings: DecisionFinding[];
}) {
  return (
    <ul className="decision-findings">
      {findings.map(({ key, title, status, quote, followUp }) => (
        <li key={key}>
          <div className="decision-finding-label">
            <div>
              {runtime.siteUrl ? (
                <a
                  href={
                    new URL(
                      "/browse/" + encodeURIComponent(key),
                      runtime.siteUrl,
                    ).href
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {key}
                </a>
              ) : (
                key
              )}{" "}
              <strong>{title}</strong>
            </div>
            <Badge
              tone={
                status === "update" || status === "confirm" ? "amber" : "green"
              }
            >
              {statusLabel[status]}
            </Badge>
          </div>
          {quote && <blockquote className="decision-quote">{quote}</blockquote>}
          <p>{followUp}</p>
        </li>
      ))}
    </ul>
  );
}

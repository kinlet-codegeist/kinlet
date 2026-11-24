import {
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  GitBranch,
  Layers,
  List,
  Network,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../app-context";
import {
  ArtifactIcon,
  Avatar,
  Badge,
  Button,
  Notice,
  PageTitle,
  SectionHeading,
  SourceChip,
  Tabs,
} from "../components/ui";

export function Project() {
  const { state, open } = useApp();
  const [view, setView] = useState("all");
  const [query, setQuery] = useState("");
  const [map, setMap] = useState(false);
  const artifacts = Object.values(state.artifacts).filter(
    (a) =>
      (view === "all" || a.kind === view) &&
      `${a.title} ${a.key}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="page">
      <PageTitle
        title="Project overview"
        description="Tracked work items, documents, and their current state."
        actions={
          <Button onClick={() => open({ type: "capture" })}>
            <Layers size={15} />
            Save checkpoint
          </Button>
        }
      />
      <div className="project-objective card">
        <div className="objective-icon">
          <Layers size={25} />
        </div>
        <div>
          <div className="eyebrow">PROJECT OBJECTIVE</div>
          <h2>{state.objective}</h2>
          <p>Compare current work against the accepted baseline.</p>
        </div>
        <div className="objective-baseline">
          <ShieldCheck size={17} />
          <span>
            Last accepted baseline<strong>{state.approvedId}</strong>
          </span>
          <Link
            to={`/checkpoints/${state.approvedId}`}
            aria-label="Inspect accepted baseline"
          >
            <ArrowUpRight size={17} />
          </Link>
        </div>
      </div>
      <div className="project-state-row">
        <span>
          <span className="tiny-dot green" />
          Main observed at {state.observedId}
        </span>
        <span>
          {
            Object.values(state.artifacts).filter((a) => a.kind === "issue")
              .length
          }{" "}
          Jira work items
        </span>
        <span>
          {
            Object.values(state.artifacts).filter((a) => a.kind === "page")
              .length
          }{" "}
          Confluence pages
        </span>
        <span className="state-row-end">
          <Badge tone="blue">Sample sources</Badge>
        </span>
      </div>
      <div className="card source-table-card">
        <div className="table-toolbar">
          <Tabs
            items={[
              {
                id: "all",
                label: "All sources",
                count: Object.keys(state.artifacts).length,
              },
              {
                id: "issue",
                label: "Work items",
                count: Object.values(state.artifacts).filter(
                  (a) => a.kind === "issue",
                ).length,
              },
              {
                id: "page",
                label: "Documents",
                count: Object.values(state.artifacts).filter(
                  (a) => a.kind === "page",
                ).length,
              },
            ]}
            value={view}
            onChange={setView}
          />
          <div className="table-tools">
            <div className="inline-search">
              <Search size={14} />
              <input
                aria-label="Search tracked sources"
                placeholder="Find a source…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="view-toggle">
              <button
                className={!map ? "active" : ""}
                onClick={() => setMap(false)}
                aria-label="Source list"
              >
                <List size={16} />
              </button>
              <button
                className={map ? "active" : ""}
                onClick={() => setMap(true)}
                aria-label="Relationship map"
              >
                <Network size={16} />
              </button>
            </div>
          </div>
        </div>
        {map ? (
          <RelationshipMap />
        ) : (
          <div className="table-scroll">
            <table className="data-table source-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Version</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {artifacts.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => open({ type: "evidence", artifactId: a.id })}
                  >
                    <td>
                      <button
                        className="artifact-title"
                        onClick={(e) => {
                          e.stopPropagation();
                          open({ type: "evidence", artifactId: a.id });
                        }}
                      >
                        <ArtifactIcon artifact={a} />
                        <span>
                          <strong>
                            {state.flags.accessLost && a.id === "policy"
                              ? "Unavailable source"
                              : a.title}
                          </strong>
                          <small>
                            {a.kind === "issue" ? a.key : "Confluence"} ·{" "}
                            {a.category}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <Badge
                        tone={
                          a.status === "Published"
                            ? "green"
                            : a.status === "In progress"
                              ? "blue"
                              : a.status === "In review"
                                ? "violet"
                                : "neutral"
                        }
                      >
                        {state.flags.accessLost && a.id === "policy"
                          ? "Unavailable"
                          : a.status}
                      </Badge>
                    </td>
                    <td>
                      <div className="owner-cell">
                        {a.owner === "Codex" ? (
                          <span className="mini-agent">⌘</span>
                        ) : (
                          <Avatar name={a.owner} size="small" />
                        )}
                        <span>{a.owner.split(" ")[0]}</span>
                      </div>
                    </td>
                    <td>
                      <span className="version-label">v{a.version}</span>
                    </td>
                    <td>
                      <ChevronRight size={15} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!artifacts.length ? (
              <div className="table-empty">No sources match that search.</div>
            ) : null}
          </div>
        )}
        <div className="table-foot">
          <ShieldCheck size={13} />
          <span>
            The sample includes ticket wording, page content, and links between sources.
          </span>
          <button onClick={() => open({ type: "help" })}>
            View coverage
            <ArrowRight size={12} />
          </button>
        </div>
      </div>
      <div className="two-column">
        <div className="card padded-card">
          <SectionHeading
            title="Project branches"
            action={
              <Link className="text-link" to="/branches">
                All branches
                <ArrowRight size={13} />
              </Link>
            }
          />
          {state.branches
            .filter((b) => b.status !== "archived")
            .slice(0, 3)
            .map((b) => (
              <Link
                className="branch-summary"
                key={b.id}
                to={`/branches/${b.id}`}
              >
                <span className={`branch-square tone-${b.color}`}>
                  <GitBranch size={17} />
                </span>
                <div>
                  <strong>{b.name}</strong>
                  <small>
                    From {b.baseId} · saved draft {b.revision}
                  </small>
                </div>
                <Badge tone={b.status === "published" ? "green" : "neutral"}>
                  {b.status === "review"
                    ? "In review"
                    : b.status === "published"
                      ? "Published"
                      : "Draft"}
                </Badge>
                <ChevronRight size={14} />
              </Link>
            ))}
        </div>
        <div className="card padded-card">
          <SectionHeading
            title="Main and accepted baseline"
            action={<ShieldCheck size={17} />}
          />
          <p className="explanation-copy">
            Main reflects the latest observed sample sources. Your accepted
            baseline records the last approved version.
          </p>
          <Notice>
            Viewing a checkpoint or editing a branch leaves Main as it is. You
            choose when to publish a reviewed change.
          </Notice>
        </div>
      </div>
    </div>
  );
}
function RelationshipMap() {
  const { state, open } = useApp();
  return (
    <div className="relationship-map">
      <div className="map-legend">
        <span>
          <i className="tiny-dot blue" />
          Work
        </span>
        <span>
          <i className="tiny-dot teal" />
          Context
        </span>
        <span>Recorded relationships</span>
      </div>
      <div className="map-row map-top">
        {state.artifacts.epic ? (
          <button
            className="map-node"
            onClick={() => open({ type: "evidence", artifactId: "epic" })}
          >
            <ArtifactIcon artifact={state.artifacts.epic} />
            <span>
              <small>{state.artifacts.epic.key}</small>
              <strong>{state.artifacts.epic.title}</strong>
            </span>
          </button>
        ) : null}
      </div>
      <div className="map-connector-v" />
      <div className="map-row map-middle">
        {["checkout", "payment", "qa"]
          .filter((id) => state.artifacts[id])
          .map((id) => (
            <button
              className="map-node"
              key={id}
              onClick={() => open({ type: "evidence", artifactId: id })}
            >
              <ArtifactIcon artifact={state.artifacts[id]} />
              <span>
                <small>{state.artifacts[id].key}</small>
                <strong>{state.artifacts[id].title}</strong>
              </span>
            </button>
          ))}
      </div>
      <div className="map-connector-v" />
      <div className="map-row map-bottom">
        <SourceChip id="design" />
        <SourceChip id="policy" />
      </div>
      <p className="map-caption">
        A bounded map of the selected sample work. This is not a live Teamwork
        Graph connection.
      </p>
    </div>
  );
}

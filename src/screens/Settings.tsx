import { ArrowRight, Check, Download, Layers } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useApp } from "../app-context";
import {
  Avatar,
  Badge,
  Button,
  Notice,
  PageTitle,
  ProviderIcon,
  SectionHeading,
  Tabs,
  TextField,
} from "../components/ui";
import { runtime } from "../platform/runtime";
import { downloadJson } from "../platform/download";

export function Settings() {
  const { state, act, open, notify } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "workspace";
  const [name, setName] = useState(state.workspaceName);
  const [objective, setObjective] = useState(state.objective);
  const tabs = [
    { id: "workspace", label: "Workspace" },
    { id: "sources", label: "Sources & people" },
    { id: "connections", label: "Connections" },
    { id: "ai", label: "AI & attention" },
    { id: "history", label: "History & data" },
  ];
  return (
    <div className="page settings-page">
      <PageTitle
        title="Settings"
        description="Manage sample workspace preferences and view connection status."
      />
      <div className="card settings-card">
        <Tabs value={tab} onChange={(tab) => setParams({ tab })} items={tabs} />
        <div className="settings-body">
          {tab === "workspace" ? (
            <>
              <SectionHeading
                title="Your workspace"
                subtitle="Set the workspace name and project objective."
              />
              <div className="settings-form">
                <TextField label="Workspace name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </TextField>
                <TextField label="Project objective">
                  <textarea
                    rows={3}
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                  />
                </TextField>
                <TextField label="Appearance">
                  <select
                    aria-label="Appearance"
                    value={state.settings.theme}
                    onChange={(e) =>
                      act((s) => {
                        s.settings.theme = e.target.value as "light" | "dark";
                      })
                    }
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </TextField>
                <Button
                  variant="primary"
                  disabled={!name.trim() || !objective.trim()}
                  onClick={() =>
                    act((s) => {
                      s.workspaceName = name.trim();
                      s.objective = objective.trim();
                    }, "Workspace preferences saved locally.")
                  }
                >
                  <Check size={14} />
                  Save preferences
                </Button>
              </div>
            </>
          ) : tab === "sources" ? (
            <>
              <SectionHeading
                title="What this workspace tracks"
                action={
                  <Button
                    size="small"
                    onClick={() => open({ type: "capture" })}
                  >
                    Choose sources for a checkpoint
                    <ArrowRight size={13} />
                  </Button>
                }
              />
              <div className="settings-source-grid">
                <div>
                  <span className="tiny-product jira-product">J</span>
                  <strong>
                    {
                      Object.values(state.artifacts).filter(
                        (a) => a.kind === "issue",
                      ).length
                    }{" "}
                    Jira work items
                  </strong>
                  <p>
                    Descriptions, summaries, priorities, and captured status
                    metadata.
                  </p>
                </div>
                <div>
                  <span className="tiny-product confluence-product">
                    <Layers size={13} />
                  </span>
                  <strong>
                    {
                      Object.values(state.artifacts).filter(
                        (a) => a.kind === "page",
                      ).length
                    }{" "}
                    Confluence pages
                  </strong>
                  <p>
                    Selected published sample content and version references.
                  </p>
                </div>
              </div>
              <Notice>
                Attachment files, unrelated conversations, board configuration,
                and private model reasoning are excluded from sample checkpoints.
              </Notice>
              <SectionHeading
                title="Workspace roles"
                subtitle="Example roles in this sample workspace."
              />
              <div className="people-list">
                {[
                  [state.settings.reviewer, "Owner & reviewer"],
                  ["Emma Wilson", "Editor"],
                  ["Noah Kim", "Viewer"],
                ].map(([name, role]) => (
                  <div key={name}>
                    <Avatar name={name} />
                    <span>
                      <strong>{name}</strong>
                      <small>
                        {name === state.settings.reviewer
                          ? "You"
                          : "Sample teammate"}
                      </small>
                    </span>
                    <Badge tone={role.includes("Owner") ? "blue" : "neutral"}>
                      {role}
                    </Badge>
                  </div>
                ))}
              </div>
            </>
          ) : tab === "connections" ? (
            <>
              <SectionHeading
                title="Connections"
                subtitle="Connection status for this installation."
              />
              <div className="integration-list">
                {[
                  {
                    name: "Forge",
                    detail: runtime.connected
                      ? `Installed in Jira project ${runtime.projectKey}.`
                      : "Open Kinlet in a Jira project to use this connection.",
                    icon: <Layers size={23} />,
                    badge: runtime.connected ? "Connected" : "Local preview",
                  },
                  {
                    name: "Jira",
                    detail: "Save checkpoints, compare tickets, and apply approved description edits.",
                    icon: (
                      <span className="integration-product jira-product">
                        J
                      </span>
                    ),
                    badge: runtime.connected ? "Connected" : "Requires Jira",
                  },
                  {
                    name: "Confluence",
                    detail: "Read the saved and current versions of a linked plan with your Confluence access.",
                    icon: (
                      <span className="integration-product confluence-product">
                        <Layers size={23} />
                      </span>
                    ),
                    badge: runtime.connected ? "Optional connection" : "Requires Jira",
                  },
                  {
                    name: "Codex / MCP",
                    detail: "Versioned context and app-only draft tools.",
                    icon: <ProviderIcon provider="Codex" size={43} />,
                    badge: "Not connected",
                  },
                  {
                    name: "Rovo",
                    detail:
                      "Conversational access to the same project records.",
                    icon: <ProviderIcon provider="Rovo" size={43} />,
                    badge: "Planned",
                  },
                ].map((item) => (
                  <div key={item.name} className="integration-card">
                    {item.icon}
                    <div>
                      <strong>{item.name}</strong>
                      <p>{item.detail}</p>
                    </div>
                    <Badge
                      tone={
                        item.badge === "Connected"
                          ? "green"
                          : item.badge === "Sample sources"
                            ? "blue"
                            : "neutral"
                      }
                    >
                      {item.badge}
                    </Badge>
                    <Button size="small" onClick={() => open({ type: "help" })}>
                      Kinlet guide
                      <ArrowRight size={12} />
                    </Button>
                  </div>
                ))}
              </div>
              <Notice>
                Jira checkpoints are stored as ticket attachments. Sample branches, reviews, and preferences are saved in this browser.
              </Notice>
            </>
          ) : tab === "ai" ? (
            <>
              <SectionHeading
                title="AI and review preferences"
                subtitle="Preferences for the sample workspace."
              />
              <div className="settings-form">
                <TextField label="Default attention window">
                  <select
                    value={state.budget}
                    onChange={(e) =>
                      act((s) => {
                        s.budget = Number(e.target.value);
                      }, "Attention budget updated.")
                    }
                  >
                    {[5, 10, 20, 30].map((n) => (
                      <option value={n} key={n}>
                        {n} minutes
                      </option>
                    ))}
                  </select>
                </TextField>
                <div className="settings-status-row">
                  <span>
                    <strong>Agent responses</strong>
                    <small>Preset examples</small>
                  </span>
                  <Badge>No API calls</Badge>
                </div>
                <div className="settings-status-row">
                  <span>
                    <strong>AI unavailable scenario</strong>
                    <small>Disable sample agent responses.</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="switch"
                    checked={state.flags.aiUnavailable}
                    onChange={(e) =>
                      act((s) => {
                        s.flags.aiUnavailable = e.target.checked;
                      })
                    }
                  />
                </div>
                <div className="settings-status-row">
                  <span>
                    <strong>Context packs prepared</strong>
                    <small>Actual local records, not model usage</small>
                  </span>
                  <Badge tone="blue">{state.contexts.length}</Badge>
                </div>
                <div className="settings-status-row">
                  <span>
                    <strong>Recorded sessions</strong>
                    <small>Sample inputs and reported activity</small>
                  </span>
                  <Badge tone="violet">{state.runs.length}</Badge>
                </div>
              </div>
              <Notice>
                Ranking considers decision impact, urgency, and estimated review
                effort. Priority is an ordering aid, not a probability. You can
                pin or snooze decisions from Attention.
              </Notice>
            </>
          ) : (
            <>
              <SectionHeading
                title="History and data"
                subtitle="Saved checkpoints and linked context stay until you explicitly reset the sample workspace."
              />
              <div className="settings-form">
                <TextField label="Saved-history preference">
                  <select
                    value={state.settings.retention}
                    onChange={(e) =>
                      act((s) => {
                        s.settings.retention = e.target.value;
                      }, "Local display preference saved.")
                    }
                  >
                    <option>Keep saved history</option>
                    <option>Review history every 90 days</option>
                  </select>
                </TextField>
                <p className="muted small">
                  This preference is saved in this browser. History is deleted only when you reset the sample workspace.
                </p>
                <div className="settings-status-row">
                  <span>
                    <strong>Browser storage</strong>
                    <small>
                      Sample edits and preferences in this browser
                    </small>
                  </span>
                  <Badge tone="green">Local</Badge>
                </div>
                <div className="settings-data-summary">
                  <span>
                    <strong>{state.checkpoints.length}</strong>checkpoints
                  </span>
                  <span>
                    <strong>{state.branches.length}</strong>branches
                  </span>
                  <span>
                    <strong>
                      {
                        state.publications.filter(
                          (p) => p.status === "complete",
                        ).length
                      }
                    </strong>
                    publications
                  </span>
                </div>
                <Button
                  onClick={() => {
                    downloadJson("kinlet-sample-workspace.json", {
                      prototype: true,
                      exportedAt: new Date().toISOString(),
                      workspace: state,
                    });
                    notify("Sample workspace exported.");
                  }}
                >
                  <Download size={14} />
                  Export sample workspace
                </Button>
                <Button onClick={() => open({ type: "demo" })}>
                  Open playground & reset options
                  <ArrowRight size={14} />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

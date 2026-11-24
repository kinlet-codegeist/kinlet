import {
  Bell,
  BookOpen,
  Box,
  ChevronDown,
  ChevronRight,
  CircleDot,
  CircleHelp,
  GitBranch,
  GitPullRequest,
  Grid2X2,
  History,
  Layers,
  LayoutDashboard,
  Plus,
  Search,
  Settings,
  Sparkles,
  Target,
} from "lucide-react";
import { useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useApp } from "../app-context";
import { getAttention } from "../domain/model";
import { runtime } from "../platform/runtime";
import { Avatar, Badge, BrandMark, Button, ProviderIcon } from "./ui";

export function Shell() {
  const { state, open, toast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [branchMenu, setBranchMenu] = useState(false);
  const attention = getAttention(state);
  const reviews = state.proposals.filter(
    (p) => p.status === "submitted" || p.status === "partial",
  ).length;
  const currentBranch = state.branches.find((b) =>
    location.pathname.startsWith(`/branches/${b.id}`),
  );
  const nav = [
    {
      to: "/attention",
      label: "Attention",
      icon: Target,
      count: attention.length,
    },
    { to: "/project", label: "Project overview", icon: LayoutDashboard },
    { to: "/history", label: "History", icon: History },
    {
      to: "/branches",
      label: "Branches",
      icon: GitBranch,
      count: state.branches.filter(
        (b) => b.status === "open" || b.status === "review",
      ).length,
    },
    { to: "/reviews", label: "Reviews", icon: GitPullRequest, count: reviews },
    { to: "/sessions", label: "Agent sessions", icon: Sparkles },
  ];
  return (
    <div
      className={`app-frame ${runtime.host === "forge" || window.self !== window.top || new URLSearchParams(window.location.search).get("embedded") === "1" ? "is-embedded" : ""}`}
    >
      <header className="jira-bar">
        <div className="jira-left">
          <button
            className="icon-button"
            aria-label="Workspace information"
            onClick={() => open({ type: "help" })}
          >
            <Grid2X2 size={19} />
          </button>
          <Link to="/attention" className="jira-wordmark">
            <svg width="23" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 3H10a7 7 0 0 0 7 7h3V3Z" fill="#2463eb" />
              <path d="M14 9H4a7 7 0 0 0 7 7h3V9Z" fill="#5a91f7" />
              <path d="M8 15H1a7 7 0 0 0 7 7v-7Z" fill="#a6c7ff" />
            </svg>
            <span>Jira</span>
          </Link>
          <span className="jira-separator" />
          <span className="jira-breadcrumb">
            Projects <ChevronRight size={13} />{" "}
            <span>{state.workspaceName}</span>
          </span>
        </div>
        <div className="jira-right">
          <button
            className="global-search"
            onClick={() => open({ type: "search" })}
          >
            <Search size={14} />
            <span>Search your project</span>
            <kbd>⌘ K</kbd>
          </button>
          <button
            className="icon-button"
            aria-label="Open attention queue"
            onClick={() => navigate("/attention")}
          >
            <Bell size={18} />
            {attention.length > 0 ? <i className="notification-dot" /> : null}
          </button>
          <button
            className="icon-button help-top"
            aria-label="Kinlet guide"
            onClick={() => open({ type: "help" })}
          >
            <CircleHelp size={18} />
          </button>
          <Avatar name={state.settings.reviewer} size="small" />
        </div>
      </header>
      <aside className="sidebar">
        <Link
          className="app-brand"
          to={runtime.connected ? "/jira" : "/attention"}
        >
          <BrandMark />
          <span>Kinlet</span>
        </Link>
        <Link
          className="nav-item"
          to="/jira"
          aria-label="Jira checkpoints"
          title="Jira checkpoints"
        >
          <History size={18} />
          <span>Jira checkpoints</span>
        </Link>
        <div className="workspace-card">
          <div className="workspace-icon">
            <Layers size={18} />
          </div>
          <div>
            <strong>{state.workspaceName}</strong>
            <small>Sample workspace</small>
          </div>
        </div>

        <nav aria-label="Sample workspace navigation">
          {nav.map(({ to, label, icon: Icon, count }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
              {count ? <span className="nav-count">{count}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-label">DEMO SOURCES</div>
          <button
            className="connection-row"
            onClick={() => navigate("/settings?tab=connections")}
          >
            <span className="tiny-product jira-product">J</span>
            <span>Jira</span>
            <span className="connection-dot" />
          </button>
          <button
            className="connection-row"
            onClick={() => navigate("/settings?tab=connections")}
          >
            <span className="tiny-product confluence-product">
              <Layers size={12} />
            </span>
            <span>Confluence</span>
            <span className="connection-dot" />
          </button>
          <div className="sidebar-divider" />
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          >
            <Settings size={17} />
            <span>Settings</span>
          </NavLink>
          <button className="nav-item" onClick={() => open({ type: "help" })}>
            <BookOpen size={17} />
            <span>Kinlet guide</span>
          </button>
          <button
            className="prototype-card"
            onClick={() => open({ type: "demo" })}
          >
            <span className="prototype-orb">
              <Box size={15} />
            </span>
            <span>
              <strong>Demo controls</strong>
              <small>
                {runtime.connected
                  ? "Forge · demo data"
                  : "Local preview · demo data"}
              </small>
            </span>
            <ChevronRight size={14} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <div className="workspace-bar">
          <div className="workspace-trail">
            <span>{state.workspaceName}</span>
            <ChevronRight size={13} />
            <div className="branch-selector-wrap">
              <button
                className="branch-selector"
                onClick={() => setBranchMenu(!branchMenu)}
                aria-expanded={branchMenu}
              >
                <GitBranch size={14} />
                {currentBranch ? currentBranch.name : "Main"}
                <ChevronDown size={12} />
              </button>
              {branchMenu ? (
                <>
                  <div
                    className="menu-dismiss"
                    onClick={() => setBranchMenu(false)}
                  />
                  <div className="dropdown-menu branch-dropdown">
                    <small>VIEW PROJECT STATE</small>
                    <button
                      onClick={() => {
                        setBranchMenu(false);
                        navigate("/project");
                      }}
                    >
                      <CircleDot size={15} />
                      Main <Badge tone="green">Observed</Badge>
                    </button>
                    {state.branches
                      .filter((b) => b.status !== "archived")
                      .map((b) => (
                        <button
                          key={b.id}
                          onClick={() => {
                            setBranchMenu(false);
                            navigate(`/branches/${b.id}`);
                          }}
                        >
                          <GitBranch size={15} />
                          <span>{b.name}</span>
                        </button>
                      ))}
                    <button
                      onClick={() => {
                        setBranchMenu(false);
                        navigate("/history");
                      }}
                    >
                      <History size={15} />
                      Browse checkpoints
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
          <div className="workspace-actions">
            <button
              className="prototype-pill"
              onClick={() => open({ type: "demo" })}
            >
              <span />
              Sample workspace
            </button>
            <span className="saved-indicator">
              <CheckCircleIcon />
              {runtime.connected
                ? `Forge connected · ${runtime.projectKey}`
                : "Local preview · demo data"}
            </span>
            <Button size="small" onClick={() => open({ type: "capture" })}>
              <Plus size={14} />
              Save checkpoint
            </Button>
          </div>
        </div>
        <main id="main-content">
          <Outlet key={location.pathname} />
        </main>
      </div>
      {toast ? (
        <div
          className={`toast toast-${toast.kind}`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          <CircleDot size={17} />
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
function CheckCircleIcon() {
  return <span className="saved-dot" />;
}
export function AgentSummary({ compact = false }: { compact?: boolean }) {
  const { state } = useApp();
  const navigate = useNavigate();
  return (
    <div className={`agent-summary ${compact ? "compact" : ""}`}>
      {state.runs
        .slice(-2)
        .reverse()
        .map((run) => (
          <button
            className="agent-summary-row"
            key={run.id}
            onClick={() => navigate(`/sessions/${run.id}`)}
          >
            <ProviderIcon provider={run.provider} size={32} />
            <span>
              <strong>{run.provider}</strong>
              <small>
                {run.status === "waiting"
                  ? "Waiting for your decision"
                  : run.status === "finished"
                    ? "Work reviewed"
                    : "Proposal ready for review"}
              </small>
            </span>
            <ChevronRight size={15} />
          </button>
        ))}
    </div>
  );
}

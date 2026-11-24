import { useEffect } from "react";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AppProvider, useApp } from "./app-context";
import { OverlayHost } from "./components/Overlays";
import { Shell } from "./components/Shell";
import { runtime } from "./platform/runtime";
import { JiraCheckpoints } from "./screens/JiraCheckpoints";
import { Attention } from "./screens/Attention";
import { BranchDetail, Branches } from "./screens/Branches";
import { ContextBuilder } from "./screens/Context";
import { CheckpointDetail, History } from "./screens/History";
import { Project } from "./screens/Project";
import { PublicationReceipt, ReviewDetail, Reviews } from "./screens/Reviews";
import { SessionDetail, Sessions } from "./screens/Sessions";
import { Settings } from "./screens/Settings";
import { Setup } from "./screens/Setup";

function AppRoutes() {
  const { state, open } = useApp();
  const location = useLocation();
  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
  }, [state.settings.theme]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (
        location.pathname !== "/jira" &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        open({ type: "search" });
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [open, location.pathname]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);
  return (
    <>
      <Routes>
        <Route path="jira" element={<JiraCheckpoints />} />
        <Route element={<Shell />}>
          <Route
            index
            element={
              <Navigate
                to={
                  runtime.connected
                    ? "/jira"
                    : state.setupDone
                      ? "/attention"
                      : "/setup"
                }
                replace
              />
            }
          />
          <Route path="attention" element={<Attention />} />
          <Route path="project" element={<Project />} />
          <Route path="history" element={<History />} />
          <Route path="checkpoints/:id" element={<CheckpointDetail />} />
          <Route path="branches" element={<Branches />} />
          <Route path="branches/:id" element={<BranchDetail />} />
          <Route path="branches/:id/context" element={<ContextBuilder />} />
          <Route path="reviews" element={<Reviews />} />
          <Route path="reviews/:id" element={<ReviewDetail />} />
          <Route path="publications/:id" element={<PublicationReceipt />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="sessions/:id" element={<SessionDetail />} />
          <Route path="settings" element={<Settings />} />
          <Route path="setup" element={<Setup />} />
          <Route path="*" element={<Navigate to="/attention" replace />} />
        </Route>
      </Routes>
      <OverlayHost />
    </>
  );
}
export default function App() {
  return (
    <HashRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppProvider>
        <AppRoutes />
      </AppProvider>
    </HashRouter>
  );
}

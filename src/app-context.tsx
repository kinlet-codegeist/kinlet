import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { gateway } from "./data/gateway";
import type { Artifact, WorkspaceState } from "./domain/types";

export type Overlay =
  | { type: "capture" }
  | { type: "branch"; checkpointId?: string }
  | {
      type: "evidence";
      artifactId: string;
      checkpointId?: string;
      source?: Artifact;
    }
  | { type: "demo" }
  | { type: "help" }
  | { type: "search" }
  | { type: "question"; questionId: string };
type Toast = { message: string; kind: "success" | "error" | "info" };
type AppContextValue = {
  state: WorkspaceState;
  overlay: Overlay | null;
  toast: Toast | null;
  open: (overlay: Overlay) => void;
  close: () => void;
  notify: (message: string, kind?: Toast["kind"]) => void;
  act: <T>(
    command: (s: WorkspaceState) => T,
    message?: string,
  ) => T | undefined;
  reset: (fresh?: boolean) => void;
};
const AppContext = createContext<AppContextValue | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(gateway.subscribe, gateway.getSnapshot);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback(
    (message: string, kind: Toast["kind"] = "success") => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ message, kind });
      timer.current = setTimeout(() => setToast(null), 5000);
    },
    [],
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const act = useCallback(
    <T,>(
      command: (s: WorkspaceState) => T,
      message?: string,
    ): T | undefined => {
      try {
        const result = gateway.transact(command);
        if (message) notify(message);
        return result;
      } catch (e) {
        notify(
          e instanceof Error
            ? e.message
            : "Something went wrong. Your sample data is safe.",
          "error",
        );
        return undefined;
      }
    },
    [notify],
  );
  return (
    <AppContext.Provider
      value={{
        state,
        overlay,
        toast,
        open: setOverlay,
        close: () => setOverlay(null),
        notify,
        act,
        reset: (fresh = false) => {
          gateway.reset(fresh);
          setOverlay(null);
          notify(fresh ? "Fresh setup is ready." : "Sample workspace reset.");
        },
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("AppProvider is required");
  return value;
}

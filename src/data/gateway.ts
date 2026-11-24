import { copy } from "../domain/model";
import type { WorkspaceState } from "../domain/types";
import { createInitialState } from "./fixtures";

/** Browser demo state. Live persistence will use validated Forge commands. */
export interface CheckpointGateway {
  getSnapshot(): WorkspaceState;
  subscribe(listener: () => void): () => void;
  transact<T>(command: (state: WorkspaceState) => T): T;
  reset(freshSetup?: boolean): void;
}
const STORAGE_KEY = "checkpoint.visual-prototype.v1";
function load(
  storageKey = STORAGE_KEY,
  initial = createInitialState(),
): WorkspaceState {
  try {
    const text =
      typeof window !== "undefined"
        ? window.localStorage.getItem(storageKey)
        : null;
    if (text) {
      const parsed = JSON.parse(text) as WorkspaceState;
      if (parsed.schemaVersion === 1 && parsed.checkpoints && parsed.flags)
        return parsed;
    }
  } catch {
    /* Sample storage may be unavailable in a restricted browser. */
  }
  return copy(initial);
}
export class MockCheckpointGateway implements CheckpointGateway {
  private state: WorkspaceState;
  private seed: WorkspaceState;
  private storageKey = STORAGE_KEY;
  private listeners = new Set<() => void>();
  constructor(initial?: WorkspaceState) {
    this.seed = copy(initial ?? createInitialState());
    this.state = initial ? copy(initial) : load();
  }
  initializeDemo = (initial: WorkspaceState, storageKey: string) => {
    this.seed = copy(initial);
    this.storageKey = storageKey;
    this.state = load(storageKey, initial);
    this.listeners.forEach((listener) => listener());
  };
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  transact = <T>(command: (state: WorkspaceState) => T): T => {
    const next = copy(this.state);
    const result = command(next);
    this.state = next;
    try {
      if (typeof window !== "undefined")
        window.localStorage.setItem(this.storageKey, JSON.stringify(next));
    } catch {
      /* Session still works without persistence. */
    }
    this.listeners.forEach((listener) => listener());
    return result;
  };
  reset = (freshSetup = false) => {
    this.state = copy(this.seed);
    if (freshSetup) {
      this.state.setupDone = false;
      this.state.checkpoints = [];
      this.state.branches = [];
      this.state.contexts = [];
      this.state.runs = [];
      this.state.proposals = [];
      this.state.publications = [];
      this.state.questions = [];
      this.state.activities = [];
      this.state.observedId = "";
      this.state.approvedId = "";
    }
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch {
      /* optional sample persistence */
    }
    this.listeners.forEach((listener) => listener());
  };
}
export const gateway = new MockCheckpointGateway();
export const demoDelay = (ms = 650) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

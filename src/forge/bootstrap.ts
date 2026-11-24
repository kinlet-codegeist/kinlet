import { createInitialState } from "../data/fixtures";
import type { DemoBootstrap } from "../platform/contracts";

/** Hardcoded demo data only. This function does not read or write Jira records. */
export function getDemoBootstrap(): DemoBootstrap {
  return {
    protocol: 1,
    dataMode: "demo",
    workspace: createInitialState(),
  };
}

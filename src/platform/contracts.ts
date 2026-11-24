import type { WorkspaceState } from "../domain/types";

export type DemoBootstrap = {
  protocol: 1;
  dataMode: "demo";
  workspace: WorkspaceState;
};

export function assertDemoBootstrap(
  value: unknown,
): asserts value is DemoBootstrap {
  const data = value as Partial<DemoBootstrap> | null;
  if (
    !data ||
    data.protocol !== 1 ||
    data.dataMode !== "demo" ||
    data.workspace?.schemaVersion !== 1 ||
    !Array.isArray(data.workspace.checkpoints) ||
    !Array.isArray(data.workspace.branches) ||
    !data.workspace.artifacts
  ) {
    throw new Error(
      "Forge returned an unsupported demo workspace. Rebuild and redeploy the app.",
    );
  }
}

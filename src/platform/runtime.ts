import { gateway } from "../data/gateway";
import { createInitialState } from "../data/fixtures";

export type HostContext = {
  cloudId?: string;
  accountId?: string;
  localId?: string;
  siteUrl?: string;
  environmentId?: string;
  extension: {
    project?: { id: string; key: string };
  };
};
export type ForgeBridge = {
  getContext(): Promise<HostContext>;
};

export const runtime: {
  host: "forge" | "preview";
  accountId?: string;
  connected: boolean;
  projectKey?: string;
  projectId?: string;
  cloudId?: string;
  siteUrl?: string;
} = {
  host: import.meta.env.MODE === "forge" ? "forge" : "preview",
  connected: false,
};

export async function initializeRuntime(bridge?: ForgeBridge): Promise<void> {
  if (runtime.host === "preview") return;
  runtime.connected = false;
  const client = bridge ?? (await loadForgeBridge());
  const context = await client.getContext();
  if (
    !context.extension.project?.id ||
    !context.extension.project.key ||
    !context.cloudId ||
    !context.accountId
  ) {
    throw new Error(
      "Open Kinlet from a Jira project where the Forge app is installed.",
    );
  }
  // Browser-only demo isolation. This context is not used for backend authorization.
  const namespace = [
    context.cloudId,
    context.environmentId ?? context.localId ?? "development",
    context.extension.project.id,
    context.accountId,
  ]
    .map(encodeURIComponent)
    .join(".");
  gateway.initializeDemo(
    createInitialState(),
    `checkpoint.forge-demo.v1.${namespace}`,
  );
  runtime.projectId = String(context.extension.project.id);
  runtime.projectKey = context.extension.project.key;
  runtime.cloudId = context.cloudId;
  runtime.accountId = context.accountId;
  runtime.siteUrl = context.siteUrl;
  runtime.connected = true;
}

async function loadForgeBridge(): Promise<ForgeBridge> {
  const { view } = await import("@forge/bridge");
  return {
    getContext: () => view.getContext() as Promise<HostContext>,
  };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { gateway } from "../data/gateway";
import { createInitialState } from "../data/fixtures";
import { initializeRuntime, runtime, type ForgeBridge } from "./runtime";

vi.mock("../data/gateway", () => ({ gateway: { initializeDemo: vi.fn() } }));

function bridge(): ForgeBridge {
  return {
    getContext: vi.fn().mockResolvedValue({
      cloudId: "cloud-a",
      accountId: "user-b",
      environmentId: "dev",
      extension: { project: { id: "100", key: "TEST" } },
    }),
  };
}

afterEach(() => {
  runtime.host = "preview";
  runtime.connected = false;
  runtime.projectKey = undefined;
  vi.clearAllMocks();
});

describe("Forge startup boundary", () => {
  it("keeps the local preview independent of Forge", async () => {
    const client = bridge();
    await initializeRuntime(client);
    expect(client.getContext).not.toHaveBeenCalled();
    expect(gateway.initializeDemo).not.toHaveBeenCalled();
  });

  it("loads the bundled fixture and isolates the browser demo by site, environment, project and user", async () => {
    runtime.host = "forge";
    const client = bridge();
    await initializeRuntime(client);
    expect(gateway.initializeDemo).toHaveBeenCalledWith(
      createInitialState(),
      "checkpoint.forge-demo.v1.cloud-a.dev.100.user-b",
    );
    expect(runtime.connected).toBe(true);
    expect(runtime.projectKey).toBe("TEST");
  });

  it("blocks startup outside a valid Jira project context", async () => {
    runtime.host = "forge";
    const client = bridge();
    vi.mocked(client.getContext).mockResolvedValue({ extension: {} });
    await expect(initializeRuntime(client)).rejects.toThrow(
      "Open Kinlet from a Jira project",
    );
    expect(gateway.initializeDemo).not.toHaveBeenCalled();
    expect(runtime.connected).toBe(false);
  });

  it("does not silently fall back to fixtures when the host bridge fails", async () => {
    runtime.host = "forge";
    const client = bridge();
    vi.mocked(client.getContext).mockRejectedValue(
      new Error("Host unavailable"),
    );
    await expect(initializeRuntime(client)).rejects.toThrow(
      "Host unavailable",
    );
    expect(gateway.initializeDemo).not.toHaveBeenCalled();
    expect(runtime.connected).toBe(false);
  });

});

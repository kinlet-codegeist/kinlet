import { describe, expect, it } from "vitest";
import { createInitialState } from "../data/fixtures";
import { MockCheckpointGateway } from "../data/gateway";
import {
  beginPublication,
  budgetAttention,
  capture,
  createBranch,
  createProposal,
  executeStep,
  getAttention,
  isConflict,
  prepareContext,
  saveArtifact,
  simulateAgent,
} from "./model";
import type { Resolution } from "./types";

describe("Versioned project workflow", () => {
  it("preserves captured states while Main and branches change independently", () => {
    const s = createInitialState();
    const saved = capture(s, "A useful moment");
    const original = s.checkpoints.find((c) => c.id === saved)!.artifacts
      .checkout.description;
    const id = createBranch(
      s,
      "Guest exploration",
      "Try guest purchases",
      saved,
    );
    const b = s.branches.find((b) => b.id === id)!;
    saveArtifact(
      s,
      id,
      "checkout",
      { description: "A new approach" },
      b.revision,
    );
    expect(s.artifacts.checkout.description).toBe(original);
    expect(
      s.checkpoints.find((c) => c.id === saved)!.artifacts.checkout.description,
    ).toBe(original);
    expect(
      s.branches.find((b) => b.id === "account-first")!.draft.checkout
        .description,
    ).not.toBe("A new approach");
  });
  it("does not promote a selective capture to complete Main", () => {
    const s = createInitialState();
    const observed = s.observedId;
    const id = capture(s, "Just the design", "", ["design"]);
    expect(s.observedId).toBe(observed);
    expect(
      Object.keys(s.checkpoints.find((c) => c.id === id)!.artifacts),
    ).toEqual(["design"]);
  });
  it("rejects a stale draft writer without overwriting another edit", () => {
    const s = createInitialState();
    const b = s.branches[0];
    const rev = b.revision;
    saveArtifact(s, b.id, "checkout", { title: "First saved title" }, rev);
    expect(() =>
      saveArtifact(s, b.id, "checkout", { title: "Outdated writer" }, rev),
    ).toThrow(/branch changed/);
    expect(b.draft.checkout.title).toBe("First saved title");
  });
  it("freezes context independently from subsequent draft edits", () => {
    const s = createInitialState();
    const b = s.branches[0];
    const id = prepareContext(s, b.id, "Guest purchases", "Keep PayPal", [
      "checkout",
      "policy",
    ]);
    const original = s.contexts.find((c) => c.id === id)!.sources.checkout
      .description;
    saveArtifact(
      s,
      b.id,
      "checkout",
      { description: "Later text" },
      b.revision,
    );
    expect(
      s.contexts.find((c) => c.id === id)!.sources.checkout.description,
    ).toBe(original);
    expect(() => simulateAgent(s, id)).toThrow(/branch has changed/);
  });
  it("keeps a submitted proposal frozen after later branch edits", () => {
    const s = createInitialState();
    const b = s.branches[0];
    const id = createProposal(s, b.id, "Review this", "An explanation");
    const before = s.proposals.find((p) => p.id === id)!.changes[0].after;
    saveArtifact(
      s,
      b.id,
      "checkout",
      { description: "Newer draft" },
      b.revision,
    );
    expect(s.proposals.find((p) => p.id === id)!.changes[0].after).toBe(before);
  });
  it("records the chosen context and a new proposal in a sample agent run", () => {
    const s = createInitialState();
    const b = createBranch(
      s,
      "Guest flow",
      "Implement guest checkout",
      s.observedId,
    );
    const ctx = prepareContext(
      s,
      b,
      "Implement guest checkout",
      "Preserve PayPal",
      ["checkout", "design", "policy"],
    );
    const pid = simulateAgent(s, ctx);
    const p = s.proposals.find((p) => p.id === pid)!;
    const run = s.runs.find((r) => r.id === p.runId)!;
    expect(run.contextId).toBe(ctx);
    expect(p.changes.some((c) => c.after.includes("guest"))).toBe(true);
    expect(s.artifacts.checkout.version).toBe(7);
  });
  it("leaves all stored state unchanged when a gateway command fails", () => {
    const gateway = new MockCheckpointGateway(createInitialState());
    const before = gateway.getSnapshot();
    expect(() =>
      gateway.transact((s) => {
        s.workspaceName = "Should not persist";
        throw new Error("Invalid command");
      }),
    ).toThrow();
    expect(gateway.getSnapshot()).toBe(before);
    expect(gateway.getSnapshot().workspaceName).toBe("Nova Commerce");
  });
});
describe("Review and verified sample publication", () => {
  it("requires an explicit resolution for each selected conflict", () => {
    const s = createInitialState();
    const p = s.proposals[0];
    expect(p.changes.every((c) => isConflict(c, s.artifacts))).toBe(true);
    expect(() =>
      beginPublication(
        s,
        p.id,
        p.changes.map((c) => c.id),
        {},
      ),
    ).toThrow(/Resolve/);
    expect(s.publications).toHaveLength(0);
  });
  it("recovers a partial publication without replaying the verified first update", () => {
    const s = createInitialState();
    const p = s.proposals[0];
    const resolutions: Record<string, Resolution> = {};
    for (const c of p.changes)
      resolutions[c.id] = { choice: "proposal", value: c.after };
    const pub = beginPublication(
      s,
      p.id,
      p.changes.map((c) => c.id),
      resolutions,
    );
    s.flags.partialPublish = true;
    expect(executeStep(s, pub)).toBe(true);
    const firstVersion = s.artifacts.checkout.version;
    expect(executeStep(s, pub)).toBe(false);
    expect(s.publications[0].status).toBe("partial");
    s.flags.partialPublish = false;
    expect(executeStep(s, pub)).toBe(true);
    expect(s.artifacts.checkout.version).toBe(firstVersion);
    expect(s.publications[0].status).toBe("complete");
    const checkpointCount = s.checkpoints.length;
    executeStep(s, pub);
    expect(s.checkpoints).toHaveLength(checkpointCount);
  });
  it("recognizes a keep-current resolution without inventing a new native version", () => {
    const s = createInitialState();
    const p = s.proposals[0];
    const c = p.changes[0];
    const version = s.artifacts[c.artifactId].version;
    const pub = beginPublication(s, p.id, [c.id], {
      [c.id]: { choice: "current", value: s.artifacts[c.artifactId][c.field] },
    });
    executeStep(s, pub);
    expect(s.artifacts[c.artifactId].version).toBe(version);
    expect(s.publications[0].steps[0].alreadyPresent).toBe(true);
    expect(s.branches[0].status).toBe("partial");
    expect(s.approvedId).toBe("C12");
  });
  it("stops when source values change after the selected review", () => {
    const s = createInitialState();
    const p = s.proposals[1];
    const pub = beginPublication(
      s,
      p.id,
      p.changes.map((c) => c.id),
      {},
    );
    s.artifacts.payment.description = "Changed outside the review";
    executeStep(s, pub);
    expect(s.publications[0].status).toBe("partial");
    expect(s.artifacts.payment.description).toBe("Changed outside the review");
  });
});
describe("Attention budget", () => {
  it("keeps required recovery visible even when it exceeds the time window", () => {
    const s = createInitialState();
    const items = getAttention(s);
    items[0].mandatory = true;
    items[0].minutes = 10;
    const plan = budgetAttention(items, 5, []);
    expect(plan.selected.some((i) => i.id === items[0].id)).toBe(true);
    expect(plan.total).toBeGreaterThan(5);
  });
  it("fits ordinary decisions into the selected budget and preserves excluded work", () => {
    const s = createInitialState();
    const items = getAttention(s);
    const plan = budgetAttention(items, 5, []);
    expect(plan.total).toBeLessThanOrEqual(5);
    expect(plan.selected.length + plan.remaining.length).toBe(items.length);
    expect(plan.remaining.length).toBeGreaterThan(0);
  });
});

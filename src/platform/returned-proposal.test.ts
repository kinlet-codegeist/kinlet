import { describe, expect, it, vi } from "vitest";
import { textDocument } from "../domain/ticket-draft";
import { plainText } from "./atlassian-text";
import type { SampleHandoffSource } from "./decision-handoff";
import {
  applyReturnedProposal,
  inspectReturnedProposal,
  parseReturnedProposal,
  selectedProposalDocument,
} from "./returned-proposal";
import {
  composeReturnedChanges,
  locateReturnedChanges,
} from "./returned-passages";
import type { DecisionEntry } from "./review-decisions";

const entry: DecisionEntry = {
  id: "decision",
  checkpointId: "checkpoint",
  pageId: "checkout",
  version: 6,
  created: "2026-11-19T00:00:00Z",
  author: "Reviewer",
};
const before = {
  summary: "Checkout",
  description: "Require sign-in before payment.",
};
const live = {
  summary: "Checkout",
  description: "Allow guests to pay. Preserve the PayPal integration.",
};
const signIn = "Require sign-in before retrying payment.";
const retry = "Let shoppers retry without creating a second order.";
function sampleFixture() {
  const applyReturnedEdit = vi.fn<SampleHandoffSource["applyReturnedEdit"]>();
  const source: SampleHandoffSource = {
    kind: "sample",
    key: "NOVA-102",
    ticket: live,
    descriptionDoc: textDocument(live.description),
    appliedEdits: [],
    applyReturnedEdit,
    plan: { id: "checkout", version: 7, title: "Checkout plan" },
    async readPlanVersion(version) {
      return {
        ...source.plan,
        version,
        text: version === 6 ? before.description : live.description,
      };
    },
  };
  const handoff = {
    format: "kinlet.decision-handoff.v1",
    source: "sample",
    ticket: { key: source.key, current: before },
    review: { id: entry.id, checkpointId: entry.checkpointId },
    plan: { pageId: entry.pageId, reviewedVersion: 6, current: { version: 6 } },
  };
  const changes = [
    { original: "", replacement: signIn, reason: "Follows the previous plan." },
    { original: "", replacement: retry, reason: "Prevent duplicate orders." },
  ];
  const proposal = parseReturnedProposal(
    JSON.stringify({ ...handoff, proposal: { changes } }),
  );
  return { source, applyReturnedEdit, proposal, handoff, changes };
}

describe("returned proposal review", () => {
  it("keeps only selected edits, preserves current wording and records the review", async () => {
    const { source, proposal, applyReturnedEdit } = sampleFixture();
    const preview = await inspectReturnedProposal(source, entry, proposal);
    const selection = {
      kept: [1],
      reason: "Keep guest checkout and prevent duplicate orders.",
    };
    expect(preview.plan?.saved.version).toBe(6);
    expect(preview.plan?.current.version).toBe(7);
    expect(preview.expected).toBeNull();
    expect(plainText(selectedProposalDocument(preview, selection))).toBe(
      live.description + "\n" + retry,
    );
    await applyReturnedProposal(source, entry, proposal, preview, selection);
    expect(applyReturnedEdit).toHaveBeenCalledOnce();
    const [saved, edit] = applyReturnedEdit.mock.calls[0];
    expect(plainText(saved)).toBe(live.description + "\n" + retry);
    expect(edit.review).toMatchObject({
      ...selection,
      proposalPlanVersion: 6,
      changes: proposal.changes,
    });

    source.descriptionDoc = saved;
    source.ticket = { ...live, description: plainText(saved) };
    const repeated = await inspectReturnedProposal(source, entry, proposal);
    expect(repeated.choices[1].problem).toMatch(/already appears/);
  });

  it("requires fresh review when the plan, wording or formatting changes after preview", async () => {
    const { source, proposal, applyReturnedEdit } = sampleFixture();
    const selection = { kept: [1], reason: "The retry remains relevant." };
    const preview = await inspectReturnedProposal(source, entry, proposal);
    source.plan.version = 8;
    await expect(
      applyReturnedProposal(source, entry, proposal, preview, selection),
    ).rejects.toThrow(/changed/);
    source.plan.version = 7;
    source.ticket = { ...live, summary: "New title" };
    await expect(
      applyReturnedProposal(source, entry, proposal, preview, selection),
    ).rejects.toThrow(/changed/);
    source.ticket = live;
    source.descriptionDoc = textDocument(live.description);
    source.descriptionDoc.content![0].content![0].marks = [{ type: "strong" }];
    await expect(
      applyReturnedProposal(source, entry, proposal, preview, selection),
    ).rejects.toThrow(/changed/);
    expect(applyReturnedEdit).not.toHaveBeenCalled();
  });

  it("keeps the original single-edit handoff flow working on a current ticket", async () => {
    const { source, changes, handoff, applyReturnedEdit } = sampleFixture();
    const proposal = parseReturnedProposal(
      JSON.stringify({
        ...handoff,
        ticket: { ...handoff.ticket, current: live },
        plan: { ...handoff.plan, current: { version: 7 } },
        proposal: changes[1],
      }),
    );
    const preview = await inspectReturnedProposal(source, entry, proposal);
    expect(preview.needsSelection).toBe(false);
    await applyReturnedProposal(source, entry, proposal, preview);
    expect(applyReturnedEdit.mock.calls[0][1].review).toBeUndefined();
  });

  it("targets original ranges, rejects overlap and leaves unrelated rich text intact", () => {
    const doc = textDocument("Guest checkout. Retry once.");
    const original = doc.content![0].content![0];
    const linked = {
      type: "text",
      text: "Read policy",
      marks: [{ type: "link", attrs: { href: "https://example.com/policy" } }],
    };
    doc.content![0].content!.push(linked);
    const choices = locateReturnedChanges(
      doc,
      [
        {
          original: "Guest checkout.",
          replacement: "Allow guests.",
          reason: "",
        },
        { original: "Retry once.", replacement: "Retry twice.", reason: "" },
        { original: "checkout.", replacement: "payment.", reason: "" },
        {
          original: "Read policy",
          replacement: "Remove this link",
          reason: "",
        },
      ],
      true,
    );
    const expected = composeReturnedChanges(doc, choices, [0, 1]);
    expect(expected?.content?.[0].content).toEqual([
      { ...original, text: "Allow guests. Retry twice." },
      linked,
    ]);
    expect(() => composeReturnedChanges(doc, choices, [0, 2])).toThrow(
      /overlap/,
    );
    expect(choices[3].problem).toMatch(/protected content/);
  });
});

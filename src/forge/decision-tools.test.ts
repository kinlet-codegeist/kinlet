import { afterEach, describe, expect, it, vi } from "vitest";
import { textDocument } from "../domain/ticket-draft";
import { readDecisionContext } from "./decision-tools";

const requests = vi.hoisted(() => ({
  jira: vi.fn(),
  confluence: vi.fn(),
  graph: vi.fn(),
}));
vi.mock("@forge/api", () => ({
  default: {
    asUser: () => ({
      requestJira: requests.jira,
      requestConfluence: requests.confluence,
      requestTeamworkGraph: requests.graph,
    }),
  },
  route: (parts: TemplateStringsArray, ...values: string[]) =>
    parts
      .map(
        (part, index) =>
          part +
          (index < values.length ? encodeURIComponent(values[index]) : ""),
      )
      .join(""),
}));

const cloudId = "124fabc2-c7ef-4432-917d-1d9c7db41d7d";
const invocation = { installContext: "ari:cloud:jira::site/" + cloudId };
const requestId = "432cab23-7353-43e9-8d1e-8b56075748a2";
const created = "2026-11-19T12:00:00Z";
const issue = {
  id: "103",
  key: "PAY-12",
  self: "https://team.atlassian.net/rest/api/3/issue/103",
  fields: {
    summary: "Checkout",
    description: textDocument("Let guests pay."),
    attachment: [
      {
        id: 9,
        filename: "kinlet-review-11-v6-" + requestId + ".json",
        size: 500,
        created,
        author: { displayName: "Reviewer" },
      },
    ],
  },
};
const receipt = {
  format: "kinlet.review.v2",
  issueId: issue.id,
  cloudId,
  checkpointId: "11",
  fromVersion: 5,
  version: 6,
  pageId: "7",
  requestId,
  decision: { outcome: "kept", reason: "The plan required an account." },
  wording: { summary: "Checkout", description: "Require an account." },
};
function mockJira(record = receipt) {
  requests.jira.mockImplementation(async (path) =>
    Response.json(path.includes("/attachment/content/") ? record : issue),
  );
}
afterEach(() => vi.resetAllMocks());

describe("Kinlet decision tool", () => {
  it("returns the saved decision, newer plan and goals from the invoking user's APIs", async () => {
    mockJira();
    requests.confluence.mockResolvedValue(
      Response.json({
        id: "7",
        status: "current",
        title: "Checkout plan",
        version: { number: 7 },
      }),
    );
    requests.graph.mockResolvedValue(
      Response.json({
        data: {
          jiraWorkItemGoals: {
            edges: [
              {
                node: {
                  id: "goal-1",
                  name: "Reduce checkout abandonment",
                  url: "https://home.atlassian.com/goal/123",
                },
              },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      }),
    );
    const result = JSON.parse(
      await readDecisionContext({ issueKey: " pay-12 " }, invocation),
    );
    expect(result.ticket).toMatchObject({
      key: "PAY-12",
      description: "Let guests pay.",
    });
    expect(result.decision).toMatchObject({
      status: "available",
      sourceUrl: "https://team.atlassian.net/rest/api/3/attachment/content/9",
      reason: receipt.decision.reason,
      changedTicketFields: ["description"],
      reviewedPlan: { status: "newer_version_published", currentVersion: 7 },
    });
    expect(result.linkedGoals.goals[0].name).toBe(
      "Reduce checkout abandonment",
    );
    expect(requests.graph).toHaveBeenCalledWith(
      expect.stringContaining("query Kinlet_TicketGoals"),
      {
        issue: "ari:cloud:jira:" + cloudId + ":issue/103",
      },
      "Kinlet_TicketGoals",
      undefined,
      { "X-Query-Context": "ari:cloud:platform::site/" + cloudId },
    );
  });

  it("keeps a denied ticket from exposing any decision, plan or goal", async () => {
    requests.jira.mockResolvedValue(new Response(null, { status: 403 }));
    const result = JSON.parse(
      await readDecisionContext({ issueKey: "PAY-12" }, invocation),
    );
    expect(result).toEqual({ error: expect.stringContaining("your account") });
    expect(requests.jira).toHaveBeenCalledTimes(1);
    expect(requests.confluence).not.toHaveBeenCalled();
    expect(requests.graph).not.toHaveBeenCalled();
  });

  it("validates the saved decision against the site even when given a specific attachment ID", async () => {
    mockJira({ ...receipt, cloudId: "other-site" });
    requests.graph.mockRejectedValue(new Error("Graph denied"));
    const result = JSON.parse(
      await readDecisionContext(
        { issueKey: "PAY-12", decisionId: "9" },
        invocation,
      ),
    );
    expect(result.decision).toEqual({ status: "unavailable" });
    expect(result.linkedGoals).toEqual({ status: "unavailable" });
    expect(requests.confluence).not.toHaveBeenCalled();
  });

  it("returns a readable Jira decision when the plan is restricted and Graph is unavailable", async () => {
    mockJira();
    requests.confluence.mockResolvedValue(new Response(null, { status: 403 }));
    requests.graph.mockResolvedValue(
      Response.json({ errors: [{ message: "Permission denied" }] }),
    );
    const result = JSON.parse(
      await readDecisionContext({ issueKey: "PAY-12" }, invocation),
    );
    expect(result.decision.reason).toBe(receipt.decision.reason);
    expect(result.decision.reviewedPlan).toEqual({ status: "unavailable" });
    expect(result.linkedGoals).toEqual({ status: "unavailable" });
  });
});

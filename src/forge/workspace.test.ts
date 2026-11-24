import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handler } from "./workspace-api";
import {
  toolReadContext,
  toolSaveDraft,
  toolSubmitProposal,
} from "./workspace-runs";

const fixture = vi.hoisted(() => ({
  db: null as DatabaseSync | null,
  jira: vi.fn(),
  confluence: vi.fn(),
}));
vi.mock("@forge/sql", () => ({
  default: {
    prepare(query: string) {
      let args: Array<string | number> = [];
      return {
        bindParams(...params: Array<string | number>) {
          args = params;
          return this;
        },
        async execute() {
          if (/\bLIMIT\s+\?/i.test(query))
            throw new Error("Forge SQL does not accept a parameter in LIMIT");
          const statement = fixture.db!.prepare(query);
          if (query.startsWith("SELECT"))
            return { rows: statement.all(...args) };
          return { rows: { affectedRows: statement.run(...args).changes } };
        },
      };
    },
  },
  migrationRunner: {
    enqueue() {
      return this;
    },
    async run() {
      return [];
    },
  },
}));
vi.mock("@forge/api", () => ({
  default: {
    asUser: () => ({
      requestJira: fixture.jira,
      requestConfluence: fixture.confluence,
    }),
  },
  route: (parts: TemplateStringsArray, ...values: string[]) =>
    parts
      .map(
        (part, i) =>
          part + (i < values.length ? encodeURIComponent(values[i]) : ""),
      )
      .join(""),
}));
vi.mock("@forge/resolver", () => ({
  default: class {
    handlers = new Map<string, (request: unknown) => Promise<unknown>>();
    define(name: string, operation: (request: unknown) => Promise<unknown>) {
      this.handlers.set(name, operation);
    }
    getDefinitions() {
      return (payload: {
        call: { functionKey: string; payload: unknown };
        context: unknown;
      }) =>
        this.handlers.get(payload.call.functionKey)!({
          payload: payload.call.payload,
          context: payload.context,
        });
    }
  },
}));

const ticket = { kind: "jira", id: "101" };
const page = { kind: "confluence", id: "201" };
const adf = (text: string) => ({
  version: 1,
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
let allowedPage: boolean, admin: boolean, canEdit: boolean;
let canBrowseOther: boolean;
let jiraTitle: string, pageTitle: string, pageVersion: number;
let jiraBody: ReturnType<typeof adf>, pageBody: ReturnType<typeof adf>;
let failPage: boolean;
const writes: string[] = [];
const current = "/wiki/api/v2/pages/201";
const sourceIssue = "/rest/api/3/issue/101";
const context = (user = "reviewer", project = "99") => ({
  accountId: user,
  extension: {
    project: { id: project, key: project === "99" ? "PAY" : "OPS" },
  },
});
function send<T = any>(
  key: string,
  payload: Record<string, unknown> = {},
  user?: string,
  project?: string,
): Promise<T> {
  return handler({
    context: context(user, project),
    call: { functionKey: "workspace." + key, payload },
  }) as Promise<T>;
}

beforeEach(() => {
  fixture.db?.close();
  fixture.db = new DatabaseSync(":memory:");
  fixture.db.exec(
    `CREATE TABLE kinlet_workspace(project_id TEXT, kind TEXT, id TEXT, group_id TEXT, seq INTEGER, ordered_at TEXT, payload TEXT, PRIMARY KEY(project_id,kind,id))`,
  );
  allowedPage = true;
  admin = true;
  canEdit = true;
  canBrowseOther = true;
  jiraTitle = "Checkout";
  pageTitle = "Checkout plan";
  pageVersion = 1;
  jiraBody = adf("Allow guests.");
  pageBody = adf("Checkout plan text.");
  failPage = false;
  writes.length = 0;
  fixture.jira.mockImplementation(
    async (path: string, request?: RequestInit) => {
      if (path.includes("mypermissions"))
        return Response.json({
          permissions: {
            BROWSE_PROJECTS: {
              havePermission: !path.includes("projectId=98") || canBrowseOther,
            },
            ADMINISTER_PROJECTS: { havePermission: admin },
            EDIT_ISSUES: { havePermission: canEdit },
          },
        });
      if (path.startsWith(sourceIssue) && request?.method === "PUT") {
        writes.push("Jira");
        const fields = JSON.parse(String(request.body)).fields;
        if (fields.summary !== undefined) jiraTitle = fields.summary;
        if (fields.description !== undefined) jiraBody = fields.description;
        return new Response(null, { status: 204 });
      }
      if (path === "/rest/api/3/project/PAY")
        return Response.json({ id: "99", key: "PAY" });
      if (
        path.startsWith("/rest/api/3/issue/102?") ||
        path.startsWith("/rest/api/3/issue/OPS-1?")
      )
        return canBrowseOther
          ? Response.json({
              id: "102",
              key: "OPS-1",
              fields: {
                project: { id: "98" },
                summary: "Operations checkout check",
                description: adf("Check recovery."),
                updated: "2026-11-19T12:00:00Z",
                status: { name: "Open" },
              },
            })
          : new Response(null, { status: 403 });
      if (
        path.startsWith(sourceIssue) ||
        path.startsWith("/rest/api/3/issue/PAY-1?")
      )
        return Response.json({
          id: "101",
          key: "PAY-1",
          fields: {
            project: { id: "99" },
            summary: jiraTitle,
            description: jiraBody,
            updated: "2026-11-19T12:00:00Z",
            priority: { id: "3", name: "Medium" },
            issuelinks: [
              {
                type: { name: "Relates", outward: "relates to" },
                outwardIssue: { id: "102", key: "OPS-1" },
              },
            ],
          },
        });
      return new Response(null, { status: 404 });
    },
  );
  fixture.confluence.mockImplementation(
    async (path: string, request?: RequestInit) => {
      if (!allowedPage || !path.startsWith(current))
        return new Response(null, { status: 403 });
      if (path.endsWith("/operations"))
        return Response.json({
          operations: canEdit
            ? [{ operation: "update", targetType: "page" }]
            : [],
        });
      if (request?.method === "PUT") {
        writes.push("Confluence");
        const payload = JSON.parse(String(request.body));
        expect(payload.version.number).toBe(pageVersion + 1);
        if (failPage) return new Response(null, { status: 503 });
        pageTitle = payload.title;
        pageBody = JSON.parse(payload.body.value);
        pageVersion++;
        return new Response(null, { status: 200 });
      }
      return Response.json({
        id: "201",
        status: "current",
        title: pageTitle,
        version: { number: pageVersion },
        body: {
          atlas_doc_format: {
            value: JSON.stringify(pageBody),
          },
        },
      });
    },
  );
});

async function savedBranch() {
  const checkpointId = crypto.randomUUID(),
    branchId = crypto.randomUUID();
  await send("saveScope", { issues: ["PAY-1"], pages: ["201"], revision: 0 });
  await send("capture", { requestId: checkpointId, name: "Before launch" });
  await send("createBranch", {
    requestId: branchId,
    checkpointId,
    name: "Guest checkout",
  });
  return { checkpointId, branchId };
}

async function save(
  branchId: string,
  rev: number,
  source: typeof ticket,
  title: string,
  requestId = crypto.randomUUID(),
) {
  return send("saveDraft", {
    branchId,
    expectedRevision: rev,
    requestId,
    change: { source, title },
  });
}

describe("shared project workspace", () => {
  it.each(["jira", "confluence"] as const)(
    "resumes a %s policy demo after an uncertain create and publishes one change per reviewed checkout field",
    async (mode) => {
      const native = new Map<
        string,
        {
          summary: string;
          description: ReturnType<typeof adf>;
          labels: string[];
        }
      >();
      let loseCreateResponse = true;
      const jira = fixture.jira.getMockImplementation()!;
      fixture.jira.mockImplementation(
        async (path: string, request?: RequestInit) => {
          if (path.includes("/createmeta/"))
            return Response.json({
              issueTypes: [{ id: "10001", name: "Task", subtask: false }],
            });
          if (path === "/rest/api/3/issue" && request?.method === "POST") {
            const fields = JSON.parse(String(request.body)).fields;
            const id = String(301 + native.size);
            native.set(id, fields);
            if (loseCreateResponse) {
              loseCreateResponse = false;
              return new Response(null, { status: 503 });
            }
            return Response.json({ id }, { status: 201 });
          }
          if (path === "/rest/api/3/search/jql") {
            const { jql } = JSON.parse(String(request?.body));
            return Response.json({
              issues: [...native].flatMap(([id, fields]) =>
                fields.labels.some((label) => jql.includes(label))
                  ? [{ id, fields }]
                  : [],
              ),
            });
          }
          const id = path.match(/^\/rest\/api\/3\/issue\/(30[12])/u)?.[1];
          const fields = id && native.get(id);
          if (id && fields) {
            if (request?.method === "PUT") {
              writes.push(id);
              Object.assign(fields, JSON.parse(String(request.body)).fields);
              return new Response(null, { status: 204 });
            }
            return Response.json({
              id,
              key: "PAY-" + id,
              fields: {
                ...fields,
                project: { id: "99" },
                updated: "2026-11-21T12:00:00Z",
              },
            });
          }
          return jira(path, request);
        },
      );
      let policyPage: { title: string; body: { value: string } } | undefined;
      let policyVersion = 1;
      const confluence = fixture.confluence.getMockImplementation()!;
      fixture.confluence.mockImplementation(
        async (path: string, request?: RequestInit) => {
          if (path.startsWith(current)) {
            const existing = await confluence(path, request);
            return Response.json({ ...(await existing.json()), spaceId: "40" });
          }
          if (path === "/wiki/api/v2/pages" && request?.method === "POST") {
            const payload = JSON.parse(String(request.body));
            expect(payload.spaceId).toBe("40");
            expect(payload.title).not.toBe(pageTitle);
            expect(policyPage).toBeUndefined();
            policyPage = payload;
            return Response.json({ id: "401" }, { status: 201 });
          }
          if (path.startsWith("/wiki/api/v2/pages/401") && policyPage) {
            if (request?.method === "PUT") {
              const payload = JSON.parse(String(request.body));
              expect(payload.version.number).toBe(policyVersion + 1);
              policyPage = payload;
              policyVersion++;
              writes.push("Confluence");
              return new Response(null, { status: 200 });
            }
            return Response.json({
              id: "401",
              status: "current",
              title: policyPage.title,
              version: { number: policyVersion },
              body: { atlas_doc_format: policyPage.body },
            });
          }
          return confluence(path, request);
        },
      );
      const requestId = crypto.randomUUID();
      const setup = {
        requestId,
        confirmed: true,
        pageId: mode === "confluence" ? "201" : undefined,
      };
      await expect(send("setupCheckoutDemo", setup)).rejects.toThrow(
        /Check progress/,
      );
      expect(native.size).toBe(1);
      const demo = await send("setupCheckoutDemo", setup);
      expect(await send("setupCheckoutDemo", setup)).toEqual(demo);
      expect(native.size).toBe(mode === "jira" ? 2 : 1);
      await send("changeCheckoutDemoPolicy", { requestId });
      await send("changeCheckoutDemoPolicy", { requestId });
      const original = await send("previewProposal", {
        proposalId: demo.proposalId,
      });
      expect(original.choices).toMatchObject([
        { field: "title", hold: "evidence_changed" },
        { field: "body", available: true },
      ]);
      async function publish(proposalId: string, selection: unknown[]) {
        const publicationId = crypto.randomUUID();
        await send("approve", {
          proposalId,
          requestId: publicationId,
          selection,
          reason: "Verified current sample policy.",
        });
        expect((await send("publishNext", { publicationId })).status).toBe(
          "applied",
        );
        await send("publishNext", { publicationId });
      }
      await publish(demo.proposalId, [original.choices[1]]);
      const repair = await send("prepareCheckoutDemoRepair", { requestId });
      expect(await send("prepareCheckoutDemoRepair", { requestId })).toEqual(
        repair,
      );
      const revised = await send("previewProposal", { proposalId: repair.id });
      expect(revised.choices).toMatchObject([
        { field: "title", available: true },
      ]);
      await publish(repair.id, revised.choices);
      expect(await send("checkoutDemoStatus", { requestId })).toMatchObject({
        repaired: true,
        retryApplied: true,
        policyChanged: true,
      });
      expect(writes).toEqual([
        mode === "jira" ? "302" : "Confluence",
        "301",
        "301",
      ]);
    },
  );

  it("holds the dependent field and safely publishes an independent field of the same Jira ticket", async () => {
    pageBody = adf("Sign-in is required. Retry the same order.");
    const { branchId } = await savedBranch();
    await send("saveDraft", {
      branchId,
      expectedRevision: 0,
      requestId: crypto.randomUUID(),
      change: {
        source: ticket,
        title: "Require sign-in",
        body: "Retry the same order.",
        citations: {
          title: [
            { source: page, quote: "Sign-in is required.", required: true },
          ],
          body: [
            { source: page, quote: "Retry the same order.", required: true },
          ],
        },
      },
    });
    const proposalId = crypto.randomUUID();
    await send("submitProposal", {
      branchId,
      expectedRevision: 1,
      requestId: proposalId,
      name: "Checkout acceptance",
      templateId: "requirement",
    });
    pageVersion++;
    pageBody = adf(
      "An unrelated heading. Sign-in is required. Retry the same order.",
    );
    const initial = await send("previewProposal", { proposalId });
    expect(
      initial.choices.every((item: { available: boolean }) => item.available),
    ).toBe(true);
    const publicationId = crypto.randomUUID();
    await send("approve", {
      proposalId,
      requestId: publicationId,
      selection: initial.choices,
      reason: "Use current evidence.",
    });
    pageVersion++;
    pageBody = adf("Sign-in is optional. Retry the same order.");
    const updated = await send("previewProposal", { proposalId });
    expect(updated.choices).toMatchObject([
      { field: "title", available: false, hold: "evidence_changed" },
      { field: "body", available: true },
    ]);
    expect((await send("attention")).proposals[0].held).toBe(1);
    await expect(send("publishNext", { publicationId })).resolves.toMatchObject(
      { status: "source_changed" },
    );
    await expect(send("publishNext", { publicationId })).resolves.toMatchObject(
      { status: "applied" },
    );
    expect(writes).toEqual(["Jira"]);
    expect(jiraTitle).toBe("Checkout");
    expect(jiraBody).toEqual(adf("Retry the same order."));
    const fieldId = updated.choices[0].id;
    const repair = await send("repair", { proposalId, fieldId });
    expect(await send("repair", { proposalId, fieldId })).toMatchObject({
      id: repair.id,
    });
    await expect(
      send("submitProposal", {
        branchId: repair.id,
        expectedRevision: 1,
        requestId: crypto.randomUUID(),
        name: "Unchanged seed",
      }),
    ).rejects.toThrow(/Save a revised field/);
    const runId = crypto.randomUUID();
    await send("openRun", {
      branchId: repair.id,
      requestId: runId,
      expectedRevision: 1,
      objective: "Revise only the title",
    });
    const tool = { projectId: "99", runId };
    const principal = { principal: { accountId: "reviewer" } };
    expect(JSON.parse(await toolReadContext(tool, principal))).toMatchObject({
      repair: {
        source: ticket,
        field: "title",
        previousDraft: "Require sign-in",
      },
    });
    for (const change of [
      {
        source: ticket,
        title: "Guest checkout",
        body: "Replace the verified check.",
      },
      { source: page, title: "Replace the source page" },
    ]) {
      const attempt = {
        requestId: crypto.randomUUID(),
        expectedRevision: 1,
        change,
      };
      await expect(
        send("saveDraft", { ...attempt, branchId: repair.id }),
      ).rejects.toThrow(/assigned record and field/);
      expect(
        JSON.parse(
          await toolSaveDraft(
            {
              ...tool,
              ...attempt,
              changeJson: JSON.stringify(change),
            },
            principal,
          ),
        ),
      ).toMatchObject({
        error: expect.stringMatching(/assigned record and field/),
      });
    }
    const fork = await send("forkRevision", {
      branchId: repair.id,
      revision: 1,
      requestId: crypto.randomUUID(),
      name: "Repair fork",
    });
    await expect(
      send("saveDraft", {
        branchId: fork.id,
        expectedRevision: 1,
        requestId: crypto.randomUUID(),
        change: { source: ticket, body: "Outside repair scope." },
      }),
    ).rejects.toThrow(/assigned record and field/);
    allowedPage = false;
    await expect(send("repair", { proposalId, fieldId })).rejects.toThrow(
      /Restore access/,
    );
    expect(
      JSON.parse(await toolReadContext(tool, principal)).repair,
    ).toBeUndefined();
    allowedPage = true;
    const revised = await toolSaveDraft(
      {
        ...tool,
        expectedRevision: 1,
        requestId: crypto.randomUUID(),
        changeJson: JSON.stringify({
          source: ticket,
          title: "Verify guest checkout",
          citations: {
            title: [
              { source: page, quote: "Sign-in is optional.", required: true },
            ],
          },
        }),
      },
      principal,
    );
    expect(JSON.parse(revised)).toEqual({ revision: 2 });
    await expect(
      send("saveDraft", {
        branchId: repair.id,
        expectedRevision: 1,
        requestId: crypto.randomUUID(),
        change: { source: ticket, title: "Older repair revision" },
      }),
    ).rejects.toThrow(/newer draft revision/);
    const repairProposal = crypto.randomUUID();
    expect(
      JSON.parse(
        await toolSubmitProposal(
          {
            ...tool,
            expectedRevision: 2,
            requestId: repairProposal,
            name: "Repair checkout title",
          },
          principal,
        ),
      ),
    ).toEqual({ id: repairProposal });
    expect(
      (await send("timeline", { proposalId: repairProposal })).entries,
    ).toContainEqual(
      expect.objectContaining({
        title: "Original proposal with held edit",
        id: proposalId,
      }),
    );
    pageVersion++;
    pageBody = adf(
      "Sign-in is required for saved cards. Retry the same order.",
    );
    expect(
      (await send("previewProposal", { proposalId: repairProposal })).choices,
    ).toMatchObject([{ field: "title", hold: "evidence_changed" }]);
    expect(
      (await send("repair", { proposalId: repairProposal, fieldId })).id,
    ).not.toBe(repair.id);
    pageVersion++;
    pageBody = adf("Sign-in is optional. Retry the same order.");
    const successor = await send("followUp", {
      proposalId,
      requestId: crypto.randomUUID(),
      name: "Review sign-in",
      fields: [updated.choices[0].id],
    });
    await expect(
      send("submitProposal", {
        branchId: successor.id,
        expectedRevision: 1,
        requestId: crypto.randomUUID(),
        name: "Retry title",
      }),
    ).rejects.toThrow(/required evidence/);
    await send("saveDraft", {
      branchId: successor.id,
      expectedRevision: 1,
      requestId: crypto.randomUUID(),
      change: {
        source: ticket,
        title: "Allow guest checkout",
        citations: {
          title: [
            { source: page, quote: "Sign-in is optional.", required: true },
          ],
        },
      },
    });
    const successorId = crypto.randomUUID();
    await send("submitProposal", {
      branchId: successor.id,
      expectedRevision: 2,
      requestId: successorId,
      name: "Guest checkout",
    });
    const timeline = await send("timeline", { proposalId: successorId });
    expect(timeline.entries).toContainEqual(
      expect.objectContaining({ title: "Earlier proposal", id: proposalId }),
    );
    const nextPublicationId = crypto.randomUUID();
    const next = await send("previewProposal", { proposalId: successorId });
    await send("approve", {
      proposalId: successorId,
      requestId: nextPublicationId,
      selection: next.choices,
      reason: "Apply the revised requirement.",
    });
    await expect(
      send("publishNext", { publicationId: nextPublicationId }),
    ).resolves.toMatchObject({ status: "applied" });
    const attention = await send("attention");
    expect(
      attention.proposals.find((item: { id: string }) => item.id === proposalId)
        .held,
    ).toBeUndefined();
    expect(
      attention.publications.find(
        (item: { id: string }) => item.id === publicationId,
      ).steps,
    ).toEqual(["applied"]);
    const reversal = await send("reversePublication", {
      publicationId: nextPublicationId,
      requestId: crypto.randomUUID(),
      name: "Restore checkout title",
    });
    const reversalId = crypto.randomUUID();
    await send("submitProposal", {
      branchId: reversal.id,
      expectedRevision: 1,
      requestId: reversalId,
      name: "Restore checkout title",
    });
    expect(
      (await send("previewProposal", { proposalId: reversalId })).choices,
    ).toMatchObject([
      { field: "title", proposed: "Checkout", available: true },
    ]);
    expect(jiraTitle).toBe("Allow guest checkout");
    allowedPage = false;
    expect(
      (await send("previewProposal", { proposalId })).choices[0],
    ).toMatchObject({
      hold: "evidence_unavailable",
      proposed: "",
      citations: [{ status: "unavailable", required: true }],
    });
    expect((await send("publication", { publicationId })).reason).toBe(
      "Review reason unavailable.",
    );
    expect(await send("timeline", { proposalId })).toEqual({
      unavailable: true,
      entries: [],
    });
  });

  it("freezes template permission choices and checks native edit access", async () => {
    const { branchId } = await savedBranch();
    await send("saveTemplate", {
      id: "bug",
      revision: 0,
      name: "Bug fix",
      instructions: "Test both paths.",
      evidenceFor: [],
      approval: "admins",
    });
    const runId = crypto.randomUUID();
    await send("openRun", {
      requestId: runId,
      branchId,
      expectedRevision: 0,
      objective: "Check the bug",
      templateId: "bug",
    });
    await send("saveTemplate", {
      id: "bug",
      revision: 1,
      name: "Bug fix",
      instructions: "Updated instructions.",
      evidenceFor: [],
      approval: "editors",
    });
    expect((await send("context", { runId })).run.template).toMatchObject({
      revision: 1,
      approval: "admins",
    });
    await save(branchId, 0, ticket, "Fix checkout");
    const id = crypto.randomUUID();
    await send("submitProposal", {
      requestId: id,
      branchId,
      expectedRevision: 1,
      name: "Fix checkout",
      templateId: "bug",
    });
    const { choices } = await send("previewProposal", { proposalId: id });
    canEdit = false;
    await expect(
      send("approve", {
        requestId: crypto.randomUUID(),
        proposalId: id,
        selection: choices,
        reason: "Approved",
      }),
    ).rejects.toThrow(/permission to edit/);
    expect(writes).toEqual([]);
  });

  it("carries administrator-confirmed public Bitbucket evidence into new runs", async () => {
    const { branchId } = await savedBranch();
    const evidence = {
      url: "https://bitbucket.org/atlassian/aui/pull-requests/5540",
      commit: "a".repeat(40),
      observedAt: new Date().toISOString(),
      statuses: [{ key: "checks", state: "SUCCESSFUL" }],
    };
    const request = { branchId, evidence, publicConfirmed: true };
    await expect(
      send("importBitbucket", { ...request, publicConfirmed: false }),
    ).rejects.toThrow(/confirm/);
    admin = false;
    await expect(send("importBitbucket", request)).rejects.toThrow(
      /administrator/,
    );
    admin = true;
    await expect(send("importBitbucket", request)).resolves.toEqual(evidence);
    const runId = crypto.randomUUID();
    await send("openRun", {
      branchId,
      requestId: runId,
      expectedRevision: 0,
      objective: "Check build evidence",
    });
    expect((await send("context", { runId })).run.bitbucket).toEqual(evidence);
  });

  it("shows readable linked tickets and rechecks access to a reused decision", async () => {
    expect(await send("crossProjectImpact", { ticket: "PAY-1" })).toEqual([
      expect.objectContaining({ key: "OPS-1", status: "Open" }),
    ]);
    canBrowseOther = false;
    expect(await send("crossProjectImpact", { ticket: "PAY-1" })).toEqual([]);
    canBrowseOther = true;
    const { branchId } = await savedBranch();
    await send("saveDraft", {
      branchId,
      expectedRevision: 0,
      requestId: crypto.randomUUID(),
      change: {
        source: ticket,
        title: "Keep checkout recovery",
        citations: {
          title: [
            { source: page, quote: "Checkout plan text.", required: true },
          ],
        },
      },
    });
    const proposalId = crypto.randomUUID();
    await send("submitProposal", {
      branchId,
      expectedRevision: 1,
      requestId: proposalId,
      name: "Recovery decision",
    });
    const { choices } = await send("previewProposal", { proposalId });
    const publicationId = crypto.randomUUID();
    await send("approve", {
      proposalId,
      requestId: publicationId,
      selection: choices,
      reason: "Keep the existing checkout recovery procedure.",
    });
    await send("publishNext", { publicationId });
    const inOps = (key: string, payload: Record<string, unknown>) =>
      send(key, payload, "reviewer", "98");
    const { hits } = await inOps("searchOtherDecisions", {
      sourceProject: "PAY",
      query: "checkout recovery",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ publicationId, project: "99" });
    const reused = await inOps("reuseDecision", {
      project: "99",
      publicationId,
      requestId: crypto.randomUUID(),
      ticket: "OPS-1",
      name: "Reuse recovery check",
    });
    expect(await inOps("branchOrigin", { branchId: reused.id })).toMatchObject({
      reason: "Keep the existing checkout recovery procedure.",
      checks: [{ wording: "Keep checkout recovery" }],
    });
    allowedPage = false;
    expect(await inOps("branchOrigin", { branchId: reused.id })).toBeNull();
    expect((await inOps("branch", { branchId: reused.id })).changes).toEqual(
      [],
    );
  });

  it("keeps shared snapshots immutable and hides revoked source content", async () => {
    const { checkpointId } = await savedBranch();
    jiraTitle = "Checkout revised in Jira";
    const second = await send(
      "compare",
      { baseId: checkpointId, source: ticket },
      "teammate",
    );
    expect(second.saved.version.title).toBe("Checkout");
    expect(second.current.version.title).toBe(jiraTitle);
    allowedPage = false;
    const hidden = await send(
      "compare",
      { baseId: checkpointId, source: page },
      "teammate",
    );
    expect(hidden.saved).toEqual({ status: "unavailable" });
    const coverage = await send("coverage", { checkpointId }, "teammate");
    expect(
      coverage.sources.map((item: { source: typeof ticket }) => item.source),
    ).toEqual([ticket]);
    const exported = await send(
      "exportCheckpoint",
      { checkpointId },
      "teammate",
    );
    expect(exported.unavailable).toBe(1);
    expect(
      exported.entries.map(({ source }: { source: typeof ticket }) => source),
    ).toEqual([ticket]);
    expect(JSON.stringify(exported)).not.toContain("Checkout plan text.");
    admin = false;
    await expect(
      send(
        "saveScope",
        { issues: ["PAY-1"], pages: [], revision: 1 },
        "teammate",
      ),
    ).rejects.toThrow(/administrator/);

    allowedPage = true;
    const restored = await send(
      "exportCheckpoint",
      { checkpointId },
      "teammate",
    );
    expect(restored.unavailable).toBe(0);
    expect(restored.entries).toContainEqual(
      expect.objectContaining({ source: page }),
    );
    expect(JSON.stringify(restored)).toContain("Checkout plan text.");
  });

  it("serializes competing drafts, and reads and submits a branch through the authenticated MCP actions", async () => {
    const { branchId } = await savedBranch();
    const writes = await Promise.allSettled([
      save(branchId, 0, ticket, "Alternative A"),
      save(branchId, 0, ticket, "Alternative B"),
    ]);
    expect(writes.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    const runId = crypto.randomUUID();
    await send("openRun", {
      requestId: runId,
      branchId,
      expectedRevision: 1,
      objective: "Ship guest checkout",
    });
    const tool = { projectId: "99", runId };
    const principal = { principal: { accountId: "reviewer" } };
    const differentCaller = JSON.parse(
      await toolReadContext(
        { ...tool, context: { accountId: "reviewer" } },
        { principal: { accountId: "teammate" } },
      ),
    );
    expect(differentCaller.error).toMatch(/owned by your Atlassian account/);
    const part = JSON.parse(
      await toolReadContext(
        { ...tool, sourceKind: "jira", sourceId: "101" },
        principal,
      ),
    );
    expect(part.title).toMatch(/^Alternative /);
    const checkpointSource = JSON.parse(
      await toolReadContext(
        {
          ...tool,
          sourceKind: "jira",
          sourceId: "101",
          sourceView: "checkpoint",
        },
        principal,
      ),
    );
    expect(checkpointSource.title).toBe("Checkout");
    const forkId = crypto.randomUUID();
    await send("forkRevision", {
      branchId,
      revision: 1,
      requestId: forkId,
      name: "Reused wording",
    });
    expect((await send("branch", { branchId: forkId })).changes[0].title).toBe(
      part.title,
    );
    const saved = JSON.parse(
      await toolSaveDraft(
        {
          ...tool,
          expectedRevision: "1",
          requestId: crypto.randomUUID(),
          changeJson: JSON.stringify({
            source: page,
            title: "Updated checkout plan",
            citations: {
              title: [
                {
                  source: ticket,
                  quote: checkpointSource.title,
                  required: true,
                },
              ],
            },
          }),
        },
        principal,
      ),
    );
    expect(saved.revision).toBe(2);
    const proposalId = crypto.randomUUID();
    const proposal = JSON.parse(
      await toolSubmitProposal(
        {
          ...tool,
          requestId: proposalId,
          expectedRevision: "2",
          name: "Publish guest checkout wording",
        },
        principal,
      ),
    );
    expect(proposal.id).toBe(proposalId);
    const { choices } = await send(
      "previewProposal",
      { proposalId },
      "teammate",
    );
    expect(choices).toHaveLength(2);
    expect(choices).toContainEqual(
      expect.objectContaining({
        source: page,
        citations: [
          expect.objectContaining({ quote: "Checkout", status: "current" }),
        ],
      }),
    );
  });

  it("rechecks permissions and resumes after an interrupted publication without repeating Jira", async () => {
    const { branchId } = await savedBranch();
    await save(branchId, 0, ticket, "Guest checkout");
    await save(branchId, 1, page, "Guest checkout plan");
    const proposalId = crypto.randomUUID();
    await send("submitProposal", {
      branchId,
      expectedRevision: 2,
      requestId: proposalId,
      name: "Guest checkout",
    });
    const preview = await send("previewProposal", { proposalId });
    const publicationId = crypto.randomUUID();
    const selection = preview.choices.map(
      ({ id, evidence }: { id: string; evidence: string }) => ({
        id,
        evidence,
      }),
    );
    await send("approve", {
      proposalId,
      requestId: publicationId,
      selection,
      reason: "Let guests pay",
    });
    await send("publishNext", { publicationId });
    failPage = true;
    expect(await send("publishNext", { publicationId })).toMatchObject({
      status: "verification_required",
    });
    expect(writes).toEqual(["Jira", "Confluence"]);
    expect(
      (await send("publication", { publicationId })).steps.map(
        (step: { status: string }) => step.status,
      ),
    ).toEqual(["applied", "verification_required"]);
    fixture.db!.exec(
      "UPDATE kinlet_workspace SET payload = json_set(payload,'$.checkedAt',0) WHERE kind = 'publish-lock'",
    );
    failPage = false;
    // Verify the previous write before retrying the same approved version.
    expect(await send("publishNext", { publicationId })).toMatchObject({
      done: true,
      status: "applied",
    });
    expect(writes).toEqual(["Jira", "Confluence", "Confluence"]);
    const result = await send("capturePublished", { publicationId });
    expect(result.id).toBe(publicationId);
    expect(pageTitle).toBe("Guest checkout plan");
    expect(
      (await send("searchApprovals", { query: "guests" })).hits[0]
        .publicationId,
    ).toBe(publicationId);
    allowedPage = false;
    expect((await send("searchApprovals", { query: "guests" })).hits).toEqual(
      [],
    );
  });

  it("requires a new approval after a page version advances and keeps the Jira write", async () => {
    const { branchId } = await savedBranch();
    await save(branchId, 0, ticket, "Guest checkout");
    await save(branchId, 1, page, "Guest checkout plan");
    const proposalId = crypto.randomUUID();
    await send("submitProposal", {
      branchId,
      expectedRevision: 2,
      requestId: proposalId,
      name: "Guest checkout",
    });
    const preview = await send("previewProposal", { proposalId });
    const approval = {
      proposalId,
      requestId: crypto.randomUUID(),
      selection: preview.choices,
      reason: "Align the titles",
    };
    await expect(send("approve", approval)).resolves.toEqual({
      id: approval.requestId,
    });
    await expect(send("approve", approval)).resolves.toEqual({
      id: approval.requestId,
    });
    await send("publishNext", { publicationId: approval.requestId });
    pageVersion++;
    await expect(
      send("publishNext", { publicationId: approval.requestId }),
    ).resolves.toMatchObject({ status: "source_changed" });
    expect(writes).toEqual(["Jira"]);
    const remaining = await send("previewProposal", { proposalId });
    expect(remaining.choices).toMatchObject([{ source: page }]);
    const renewed = await send("approve", {
      ...approval,
      requestId: crypto.randomUUID(),
      selection: remaining.choices,
    });
    await expect(
      send("publishNext", { publicationId: renewed.id }),
    ).resolves.toMatchObject({ done: true, status: "applied" });
    expect(writes).toEqual(["Jira", "Confluence"]);
    const attention = await send("attention");
    expect(attention.publications).toContainEqual(
      expect.objectContaining({ id: approval.requestId, steps: ["applied"] }),
    );
    const original = await send("publication", {
      publicationId: approval.requestId,
    });
    expect(
      original.steps.map(({ status }: { status: string }) => status),
    ).toEqual(["applied", "source_changed"]);
  });

  it("protects shared session exports and applies administrator retention", async () => {
    const { branchId } = await savedBranch();
    const runId = crypto.randomUUID();
    await send("openRun", {
      requestId: runId,
      branchId,
      expectedRevision: 0,
      objective: "Review the plan",
    });
    const session = {
      format: "kinlet.codex-session.v1",
      runId,
      threadId: "codex-thread",
      events: [
        {
          kind: "agent_message",
          at: "2026-11-19T12:00:00.000Z",
          text: "Reviewed the draft.",
        },
      ],
    };
    await send("importSession", { runId, session });
    expect((await send("run", { runId }, "teammate")).session.events).toEqual(
      session.events,
    );
    allowedPage = false;
    expect((await send("run", { runId }, "teammate")).session).toBeUndefined();
    allowedPage = true;
    await send("saveRetention", { days: 30 });
    fixture.db!.exec(
      "UPDATE kinlet_workspace SET ordered_at = '2020-01-01T00:00:00Z', payload = json_set(payload,'$.importedAt','2020-01-01T00:00:00Z') WHERE kind = 'session'",
    );
    expect((await send("run", { runId })).session).toBeUndefined();
    expect(await send("removeExpiredSessions")).toEqual({ count: 1 });
    admin = false;
    await expect(
      send("saveRetention", { days: 90 }, "teammate"),
    ).rejects.toThrow(/administrator/);
  });

  it("saves two decision branches from one verified set of sources and carries visible findings into Codex", async () => {
    const original = "Require shoppers to sign in before payment.";
    const retry = "Verify that a PayPal retry uses the original order.";
    const cards = "Require sign-in only for saved cards.";
    const records = [
      {
        id: "102",
        key: "PAY-2",
        title: "Checkout sign-in test",
        text: original,
      },
      { id: "103", key: "PAY-3", title: "PayPal retry test", text: retry },
      { id: "104", key: "PAY-4", title: "Saved cards", text: cards },
      {
        id: "105",
        key: "PAY-5",
        title: "Payment recovery",
        text: "Show a recovery screen.",
      },
      { id: "106", key: "HIDDEN-1", title: "Outside project", text: original },
    ];
    let recoveryVisible = true;
    const jira = fixture.jira.getMockImplementation()!;
    fixture.jira.mockImplementation(
      async (path: string, request?: RequestInit) => {
        const record = records.find(({ id }) =>
          path.startsWith("/rest/api/3/issue/" + id + "?"),
        );
        if (record) {
          if (record.key === "PAY-5" && !recoveryVisible)
            return new Response(null, { status: 403 });
          return Response.json({
            id: record.id,
            key: record.key,
            fields: {
              project: { id: record.key === "HIDDEN-1" ? "100" : "99" },
              summary: record.title,
              description: adf(record.text),
              updated: "2026-11-19T12:00:00Z",
            },
          });
        }
        const response = await jira(path, request);
        if (!response.ok || !path.startsWith("/rest/api/3/issue/PAY-1?"))
          return response;
        const issue = await response.json();
        issue.fields.issuelinks = records.map(({ id, key }) => ({
          type: {
            name: "Relates",
            inward: "relates to",
            outward: "relates to",
          },
          outwardIssue: { id, key },
        }));
        return Response.json(issue);
      },
    );
    const confluence = fixture.confluence.getMockImplementation()!;
    let planBody = adf(original + " " + retry);
    fixture.confluence.mockImplementation(
      async (path: string, request?: RequestInit) => {
        const response = await confluence(path, request);
        if (!response.ok || path.endsWith("/operations")) return response;
        if (request?.method === "PUT") {
          planBody = JSON.parse(JSON.parse(String(request.body)).body.value);
          return response;
        }
        const plan = await response.json();
        plan.body.atlas_doc_format.value = JSON.stringify(planBody);
        return Response.json(plan);
      },
    );

    admin = false;
    const target = { anchorKey: "PAY-1", planId: "201" };
    const sources = await send("decisionSources", target);
    expect(sources.tickets.map(({ key }: { key: string }) => key)).toEqual([
      "PAY-2",
      "PAY-3",
      "PAY-4",
      "PAY-5",
    ]);
    expect(sources.omitted).toBe(1);
    const saveComparison = {
      ...target,
      signature: sources.signature,
      requestId: crypto.randomUUID(),
      original,
      first: { name: "Guest checkout", wording: "Allow guests to pay." },
      second: { name: "Saved cards only", wording: cards },
    };
    pageVersion++;
    await expect(send("saveDecisionBranches", saveComparison)).rejects.toThrow(
      /changed/,
    );
    expect((await send("load")).branches).toHaveLength(0);
    saveComparison.signature = (
      await send("decisionSources", target)
    ).signature;
    const [first, second] = await send("saveDecisionBranches", saveComparison);
    expect(first.checkpointId).toBe(second.checkpointId);
    expect(first.id).not.toBe(second.id);
    expect(await send("saveDecisionBranches", saveComparison)).toEqual([
      first,
      second,
    ]);
    expect((await send("load")).branches).toHaveLength(2);
    expect((await send("branch", { branchId: first.id })).changes).toEqual([
      { source: page, body: "Allow guests to pay. " + retry },
    ]);
    expect((await send("branch", { branchId: second.id })).changes).toEqual([
      { source: page, body: cards + " " + retry },
    ]);
    const findings = (await send("branchDecision", { branchId: second.id }))
      .findings;
    expect(findings).toMatchObject([
      { key: "PAY-2", status: "update", quote: original },
      { key: "PAY-3", status: "keep", quote: retry },
      { key: "PAY-4", status: "matches", quote: cards },
      { key: "PAY-5", status: "confirm" },
    ]);
    expect(
      (await send("branchDecision", { branchId: first.id })).findings[2].status,
    ).toBe("confirm");
    const runId = crypto.randomUUID();
    await send("openRun", {
      requestId: runId,
      branchId: second.id,
      expectedRevision: 1,
      objective: "Check the decision follow-ups",
    });
    expect((await send("context", { runId })).decision.findings).toEqual(
      findings,
    );
    recoveryVisible = false;
    const context = await send("context", { runId });
    expect(context.decision.unavailable).toBe(1);
    expect(JSON.stringify(context)).not.toContain("Payment recovery");
    allowedPage = false;
    expect(
      await send("branchDecision", { branchId: second.id }, "teammate"),
    ).toBeNull();
    expect((await send("context", { runId })).decision).toBeUndefined();
    expect(writes).toEqual([]);
    allowedPage = true;
    recoveryVisible = true;
    const proposalId = crypto.randomUUID();
    await send("submitProposal", {
      requestId: proposalId,
      branchId: second.id,
      expectedRevision: 1,
      name: "Use the saved cards option",
    });
    const { choices } = await send("previewProposal", { proposalId });
    expect(choices).toMatchObject([
      { source: page, field: "body", available: true },
    ]);
    const { id: publicationId } = await send("approve", {
      proposalId,
      requestId: crypto.randomUUID(),
      selection: choices,
      reason: "Keep the existing card and retry requirements.",
    });
    await expect(send("publishNext", { publicationId })).resolves.toMatchObject(
      {
        done: true,
        status: "applied",
      },
    );
    expect(writes).toEqual(["Confluence"]);
    await expect(
      send("capturePublished", { publicationId }),
    ).resolves.toMatchObject({
      sourceCount: 6,
    });
  });
});

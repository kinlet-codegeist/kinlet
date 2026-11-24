import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const original = "Require shoppers to sign in before payment.";
const retry = "Verify that a PayPal retry uses the original order.";
const savedCards = "Require sign-in only for saved cards.";
const recovery = "Show a recovery screen when a payment fails.";
const tasks = {
  anchor: [
    "Checkout policy",
    "Compare how choices about checkout access affect the linked tasks.",
  ],
  signIn: ["Checkout sign-in test", original],
  retry: ["PayPal retry test", retry],
  savedCards: ["Saved cards test", savedCards],
  recovery: ["Payment recovery", recovery],
};

const scenarios = {
  checkout: {
    plan: "Checkout plan",
    tasks,
    passages: [original, retry],
    replacement: "Allow guest checkout.",
  },
  bug: {
    plan: "Invoice retry acceptance criteria",
    passages: [
      "Retry failed invoice exports automatically.",
      "Keep the original export identifier.",
    ],
    replacement: "Require an operator to retry failed invoice exports.",
    tasks: {
      anchor: [
        "Invoice export retry",
        "Review the acceptance criteria for invoice exports.",
      ],
      behavior: [
        "Retry failed exports",
        "Retry failed invoice exports automatically.",
      ],
      check: ["Preserve export ID", "Keep the original export identifier."],
    },
  },
  runbook: {
    plan: "Queue recovery runbook",
    passages: [
      "Restart the worker before checking the queue.",
      "Record the incident identifier.",
    ],
    replacement: "Check the queue before restarting the worker.",
    tasks: {
      anchor: [
        "Review queue recovery instructions",
        "Review the linked runbook tasks.",
      ],
      behavior: [
        "Check worker recovery",
        "Restart the worker before checking the queue.",
      ],
      check: ["Record recovery evidence", "Record the incident identifier."],
    },
  },
};

const document = (...paragraphs) => ({
  type: "doc",
  version: 1,
  content: paragraphs.map((text) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  })),
});

async function request(page, method, path, data) {
  const reply = await page.evaluate(
    async ({ method, path, data }) => {
      const response = await fetch(path, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        ...(data !== undefined && { body: JSON.stringify(data) }),
      });
      let body = null;
      if (response.headers.get("Content-Type")?.includes("application/json")) {
        const text = await response.text();
        if (text) body = JSON.parse(text);
      }
      return { ok: response.ok, status: response.status, body };
    },
    { method, path, data },
  );
  if (!reply.ok)
    throw new Error(
      method +
        " " +
        path.split("?")[0] +
        " failed with HTTP " +
        reply.status +
        ".",
    );
  return reply.body;
}

async function seed({
  cdp,
  site,
  project,
  "space-from-page": reference,
  run,
  state,
  scenario = "checkout",
}) {
  if (!cdp || !site || !project || !reference || !run || !state)
    throw new Error(
      "Supply the browser, site, test project, sample page, run name, and state file.",
    );
  const connector = new URL(cdp);
  const target = new URL(site);
  if (
    connector.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(connector.hostname)
  )
    throw new Error("Use a browser debugging address on this computer.");
  if (
    target.protocol !== "https:" ||
    !/^[a-z\d-]+\.atlassian\.net$/.test(target.hostname)
  )
    throw new Error("Use the HTTPS address of your Atlassian test site.");
  if (
    !/^[A-Z][A-Z0-9_]{0,29}$/.test(project) ||
    !/^[1-9]\d{0,19}$/.test(reference) ||
    !/^[a-z0-9-]{1,34}$/.test(run)
  )
    throw new Error(
      "Use a Jira project key, a numeric Confluence page ID, and a short lowercase run name.",
    );

  const path = resolve(state);
  if (!Object.hasOwn(scenarios, scenario))
    throw new Error("Choose checkout, bug, or runbook for the fixture.");
  const preset = scenarios[scenario];
  const label = "kinlet-" + scenario + "-" + run;
  const identity = { site: target.origin, project, reference, run };
  let fixture = { ...identity, scenario, issues: {}, pageId: null };
  try {
    fixture = JSON.parse(await readFile(path, "utf8"));
    if (
      (fixture.scenario ?? "checkout") !== scenario ||
      Object.entries(identity).some(([key, value]) => fixture[key] !== value)
    )
      throw new Error("This state file already belongs to another fixture.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  async function saveState() {
    const temporary = path + ".new";
    await writeFile(temporary, JSON.stringify(fixture, null, 2) + "\n", {
      mode: 0o600,
    });
    await rename(temporary, path);
  }

  const browser = await chromium.connectOverCDP(connector.href, {
    timeout: 7000,
  });
  try {
    const page = await browser.contexts()[0].newPage();
    try {
      await page.goto(target.origin + "/jira/projects", {
        waitUntil: "domcontentloaded",
      });
      if (new URL(page.url()).origin !== target.origin)
        throw new Error(
          "Sign in to Jira in the test browser before preparing a fixture.",
        );
      const get = (resource) => request(page, "GET", resource);
      const post = (resource, data) => request(page, "POST", resource, data);
      await get("/rest/api/3/myself");
      const [scope, plan, links] = await Promise.all([
        get("/rest/api/3/project/" + project),
        get("/wiki/api/v2/pages/" + reference),
        get("/rest/api/3/issueLinkType"),
      ]);
      if (scope.key !== project || !/^[1-9]\d*$/.test(String(plan.spaceId)))
        throw new Error(
          "The Jira test project or Confluence space is unavailable.",
        );
      const relates = links.issueLinkTypes?.find(
        (item) => item.name === "Relates",
      );
      if (!relates)
        throw new Error(
          "Enable Jira’s Relates issue link type for the fixture.",
        );

      const summaries = new Map(
        Object.entries(preset.tasks).map(([role, [title]]) => [
          role,
          "Kinlet demo " + run + " · " + title,
        ]),
      );
      const existing = await post("/rest/api/3/search/jql", {
        jql: 'project = "' + project + '" AND labels = "' + label + '"',
        fields: ["summary", "labels", "project"],
        maxResults: 30,
      });
      for (const [role, [, text]] of Object.entries(preset.tasks)) {
        const summary = summaries.get(role);
        if (fixture.issues[role]) {
          const issue = await get(
            "/rest/api/3/issue/" +
              encodeURIComponent(fixture.issues[role]) +
              "?fields=labels,project",
          );
          if (
            issue.fields.project.key !== project ||
            !issue.fields.labels.includes(label)
          )
            throw new Error(
              "The state file refers to a record outside this demo.",
            );
          continue;
        }
        const matches = existing.issues.filter(
          (issue) => issue.fields.summary === summary,
        );
        if (matches.length > 1)
          throw new Error(
            "Multiple demo tickets match " +
              summary +
              ". Choose a different run name.",
          );
        const issue =
          matches[0] ??
          (await post("/rest/api/3/issue", {
            fields: {
              project: { key: project },
              issuetype: { name: "Task" },
              summary,
              description: document(text),
              labels: [label],
            },
          }));
        fixture.issues[role] = issue.key;
        await saveState();
      }

      const anchor = await get(
        "/rest/api/3/issue/" + fixture.issues.anchor + "?fields=issuelinks",
      );
      const connected = new Set(
        anchor.fields.issuelinks
          ?.filter(({ type }) => type?.name === relates.name)
          .map((link) => link.inwardIssue?.key ?? link.outwardIssue?.key),
      );
      for (const [role, key] of Object.entries(fixture.issues)) {
        if (role !== "anchor" && !connected.has(key))
          await post("/rest/api/3/issueLink", {
            type: { name: relates.name },
            inwardIssue: { key: fixture.issues.anchor },
            outwardIssue: { key },
          });
      }

      const title = "Kinlet demo " + run + " · " + preset.plan;
      if (fixture.pageId) {
        const saved = await get("/wiki/api/v2/pages/" + fixture.pageId);
        if (
          String(saved.spaceId) !== String(plan.spaceId) ||
          saved.title !== title
        )
          throw new Error(
            "The state file refers to a Confluence page outside this demo.",
          );
      } else {
        const query = new URLSearchParams({
          "space-id": String(plan.spaceId),
          title,
          status: "current",
          limit: "10",
        });
        const listed = await get("/wiki/api/v2/pages?" + query);
        const matches = listed.results.filter((item) => item.title === title);
        if (matches.length > 1)
          throw new Error("Multiple Confluence pages match this run name.");
        const published =
          matches[0] ??
          (await post("/wiki/api/v2/pages", {
            spaceId: String(plan.spaceId),
            status: "current",
            title,
            body: {
              representation: "atlas_doc_format",
              value: JSON.stringify(document(...preset.passages)),
            },
          }));
        fixture.pageId = published.id;
        await saveState();
      }
      console.log(
        JSON.stringify(
          {
            ...fixture,
            scenario,
            originalRequirement: preset.passages[0],
            revisedRequirement: preset.replacement,
            independentCheck: preset.passages[1],
            planUrl:
              target.origin +
              "/wiki/pages/viewpage.action?pageId=" +
              fixture.pageId,
          },
          null,
          2,
        ),
      );
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

const { values } = parseArgs({
  options: {
    cdp: { type: "string" },
    site: { type: "string" },
    project: { type: "string" },
    "space-from-page": { type: "string" },
    run: { type: "string" },
    state: { type: "string" },
    scenario: { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "Usage: node scripts/kinlet-checkout-fixture.mjs --cdp http://127.0.0.1:PORT --site https://SITE.atlassian.net --project KEY --space-from-page PAGE_ID --run LABEL --state FIXTURE.json [--scenario checkout|bug|runbook]",
  );
} else {
  try {
    await seed(values);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { existsSync, readFileSync } from "node:fs";
import { validate } from "@forge/manifest";
import { parse } from "yaml";

const manifest = parse(
  readFileSync(new URL("../manifest.yml", import.meta.url), "utf8"),
);
const page = manifest.modules?.["jira:projectPage"]?.find(
  (item) => item.key === "checkpoint-workspace",
);
const resource = manifest.resources?.find(
  (item) => item.key === page?.resource,
);
const decisionAction = manifest.modules?.action?.find(
  (action) => action.key === "kinlet-read-decision",
);
const declaredScopes = manifest.permissions?.scopes ?? [];
const scopes = new Set(
  Array.isArray(declaredScopes) ? declaredScopes : Object.keys(declaredScopes),
);
const canCreateJiraIssues =
  scopes.has("write:jira-work") ||
  [
    "read:issue:jira",
    "write:issue:jira",
    "write:attachment:jira",
    "write:comment:jira",
    "write:comment.property:jira",
  ].every((scope) => scopes.has(scope));

const expected = {
  "Jira project-page module": Boolean(page),
  "Jira practice-ticket creation scopes": canCreateJiraIssues,
  "Custom UI resource": resource?.path === "dist/forge-ui",
  "Built Forge frontend": existsSync("dist/forge-ui/index.html"),
  "Read-only decision tool for Rovo and MCP":
    decisionAction?.actionVerb === "GET" &&
    manifest.modules?.function?.some(
      (fn) =>
        fn.key === decisionAction.function &&
        fn.handler === "forge/decision-tools.readDecisionContext",
    ) &&
    manifest.modules?.["rovo:agent"]?.some((agent) =>
      agent.actions?.includes(decisionAction.key),
    ) &&
    manifest.modules?.["rovo:mcp"]?.some((server) =>
      server.tools?.includes(decisionAction.key),
    ),
  "Teamwork Graph issue and goal scopes":
    scopes.has("read:graph:issue:jira") &&
    scopes.has("read:graph:goal:atlassian"),
  "Node.js 24 runtime": manifest.app?.runtime?.name === "nodejs24.x",
  "Local UI tunnel": resource?.tunnel?.port === 5174,
};
const validation = await validate(false, "manifest.yml");
let failed = !validation.success;
console.log(
  `${validation.success ? "OK" : "FAIL"} Atlassian Forge manifest schema`,
);
for (const error of validation.errors ?? []) console.error(error.message);
for (const [name, valid] of Object.entries(expected)) {
  console.log(`${valid ? "OK" : "FAIL"} ${name}`);
  failed ||= !valid;
}
const appId = manifest.app?.id ?? "";
const registered =
  /^ari:cloud:ecosystem::app\/[0-9a-f-]{36}$/i.test(appId) &&
  !appId.includes("00000000-0000-4000-8000-000000000000");
console.log(
  registered
    ? "App ID configured. Account ownership and registration are verified by Forge at deploy time."
    : "App is unregistered. Authenticate and run npm run forge:register.",
);
if (process.argv.includes("--require-registration") && !registered)
  failed = true;
if (failed) process.exitCode = 1;

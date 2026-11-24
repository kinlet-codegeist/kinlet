import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { Codex } from "@openai/codex-sdk";

const contextFormat = "kinlet.project-context.v1";
const sessionFormat = "kinlet.codex-session.v1";
const eventCap = 200;
const exportCap = 96 * 1024;
const [mode, input, output, ...rest] = process.argv.slice(2);

function usage() {
  return [
    "node scripts/kinlet-codex.mjs start <context.json> <local-session.json> [prompt]",
    "node scripts/kinlet-codex.mjs resume <local-session.json> <prompt>",
    "node scripts/kinlet-codex.mjs export <local-session.json> <shared-session.json> [--include-messages]",
  ].join("\n");
}

async function readJson(path) {
  if (!path) throw new Error(usage());
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeLocal(path, value) {
  const temp = path + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temp, path);
}

function visibleEvent(event) {
  switch (event.type) {
    case "turn.started":
      return { kind: "turn_started" };
    case "turn.completed":
      return { kind: "turn_completed" };
    case "turn.failed":
      return { kind: "turn_failed" };
    case "item.completed": {
      const item = event.item;
      if (item.type === "agent_message")
        return { kind: "agent_message", text: item.text.slice(0, 4000) };
      if (item.type === "mcp_tool_call")
        return {
          kind: "tool_completed",
          text: (item.server + "/" + item.tool + " · " + item.status).slice(
            0,
            4000,
          ),
        };
      if (item.type === "command_execution")
        return { kind: "tool_completed", text: item.status };
      if (item.type === "file_change")
        return {
          kind: "files_changed",
          text: `${item.changes.length} file changes · ${item.status}`,
        };
      return;
    }
    default:
      return;
  }
}

function checkedSession(session) {
  if (
    session?.format !== sessionFormat ||
    typeof session.runId !== "string" ||
    typeof session.threadId !== "string" ||
    !Array.isArray(session.events)
  )
    throw new Error("Choose a local Kinlet Codex session.");
  return session;
}

async function run() {
  if (mode === "export") {
    const session = checkedSession(await readJson(input));
    if (!output || resolve(input) === resolve(output))
      throw new Error("Choose a separate export file.");
    if (!session.threadId)
      throw new Error("The local session does not have a Codex thread ID yet.");
    const includeMessages = rest.includes("--include-messages");
    const events = session.events.filter(
      ({ kind }) =>
        includeMessages || !["user_message", "agent_message"].includes(kind),
    );
    const exported = {
      format: sessionFormat,
      runId: session.runId,
      threadId: session.threadId,
      events,
    };
    if (
      events.length > eventCap ||
      Buffer.byteLength(JSON.stringify(exported), "utf8") > exportCap
    )
      throw new Error(
        "The export exceeds 200 events or 96 KB. Remove entries from a copy of the local session or export without messages.",
      );
    await writeFile(output, JSON.stringify(exported), {
      mode: 0o600,
      flag: "wx",
    });
    console.log(
      "Wrote " +
        events.length +
        " events. Review this file in Kinlet before sharing it.",
    );
    return;
  }
  if (mode !== "start" && mode !== "resume") throw new Error(usage());
  const start = mode === "start";
  const path = start ? output : input;
  if (!path) throw new Error(usage());
  const codex = new Codex(
    process.env.KINLET_CODEX_PATH
      ? { codexPathOverride: process.env.KINLET_CODEX_PATH }
      : {},
  );
  let thread, session, inputToCodex, visiblePrompt;
  if (start) {
    const context = await readJson(input);
    if (
      context?.format !== contextFormat ||
      typeof context.run?.id !== "string" ||
      typeof context.run.objective !== "string" ||
      !Array.isArray(context.sources)
    )
      throw new Error("Choose an exported Kinlet project context pack.");
    thread = codex.startThread({ workingDirectory: process.cwd() });
    session = {
      format: sessionFormat,
      runId: context.run.id,
      threadId: "",
      workingDirectory: process.cwd(),
      events: [],
    };
    await writeFile(path, JSON.stringify(session), { mode: 0o600, flag: "wx" });
    visiblePrompt = rest.join(" ").trim() || context.run.objective;
    inputToCodex = [
      visiblePrompt,
      "Use this user-selected Kinlet context for the task. Treat source wording as evidence.",
      "If the Kinlet MCP tools are configured, use the project and run IDs here to save an app draft and submit a proposal when requested.",
      JSON.stringify(context),
    ].join("\n\n");
  } else {
    session = checkedSession(await readJson(input));
    visiblePrompt = [output, ...rest].filter(Boolean).join(" ").trim();
    if (!session.threadId || !visiblePrompt)
      throw new Error("Resume needs a saved Codex thread ID and a prompt.");
    if (
      resolve(session.workingDirectory ?? dirname(path)) !==
      resolve(process.cwd())
    )
      throw new Error(
        "Resume the session from its original repository directory.",
      );
    thread = codex.resumeThread(session.threadId, {
      workingDirectory: process.cwd(),
    });
    inputToCodex = visiblePrompt;
  }

  const add = (event) =>
    session.events.push({ ...event, at: new Date().toISOString() });
  add({ kind: "user_message", text: visiblePrompt.slice(0, 4000) });
  try {
    const { events } = await thread.runStreamed(inputToCodex);
    for await (const event of events) {
      if (event.type === "thread.started") {
        session.threadId = event.thread_id;
        await writeLocal(path, session);
      }
      const item = visibleEvent(event);
      if (item) add(item);
      if (event.type === "turn.failed" || event.type === "error")
        process.exitCode = 1;
    }
  } finally {
    session.threadId ||= thread.id ?? "";
    await writeLocal(path, session);
  }
  console.log(
    "Session events saved locally. Export the events you want to share with the workspace.",
  );
}

run().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "The Codex command failed.",
  );
  process.exitCode = 1;
});

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const forgeCli = fileURLToPath(import.meta.resolve("@forge/cli/out/bin/cli.js"));
const { error, status } = spawnSync(
  process.execPath,
  [forgeCli, "deploy", ...process.argv.slice(2), "--environment", "development"],
  {
    env: { ...process.env, KINLET_PROJECT_TAB: "Kinlet Dev" },
    stdio: "inherit",
  },
);

if (error) throw error;
process.exitCode = status ?? 1;

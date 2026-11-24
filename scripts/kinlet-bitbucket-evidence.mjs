import { writeFile } from "node:fs/promises";

const [input, output] = process.argv.slice(2);
const pattern =
  /^https:\/\/bitbucket\.org\/([a-z\d_-]+)\/([a-z\d_.-]+)\/pull-requests\/([1-9]\d{0,11})\/?$/i;

async function get(path, query) {
  const url = new URL("/2.0/repositories/" + path, "https://api.bitbucket.org");
  if (query) url.search = new URLSearchParams(query);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(
      "Bitbucket could not share this public record (HTTP " +
        response.status +
        ").",
    );
  return response.json();
}

async function publicRepo(path) {
  const repo = await get(path, { fields: "is_private" });
  if (repo.is_private !== false)
    throw new Error("Choose a public Bitbucket repository.");
}

async function main() {
  if (input === "--help") {
    console.log(
      "Usage: node scripts/kinlet-bitbucket-evidence.mjs https://bitbucket.org/WORKSPACE/REPO/pull-requests/ID evidence.json",
    );
    return;
  }
  const match = input?.match(pattern);
  if (!match || !output)
    throw new Error(
      "Supply a public Bitbucket pull request URL and a new JSON file path.",
    );
  const [, workspace, repository, id] = match;
  if (repository === "." || repository === "..")
    throw new Error("Choose a Bitbucket repository.");
  const repo = workspace + "/" + repository;
  await publicRepo(repo);
  const pr = await get(repo + "/pullrequests/" + id, {
    fields: "source.commit.hash,source.repository.full_name",
  });
  const reportedCommit = pr.source?.commit?.hash;
  const sourceRepo = pr.source?.repository?.full_name;
  if (
    typeof reportedCommit !== "string" ||
    !/^[a-f\d]{12,40}$/i.test(reportedCommit) ||
    typeof sourceRepo !== "string" ||
    !/^[a-z\d_-]+\/[a-z\d_.-]+$/i.test(sourceRepo) ||
    /^\.{1,2}$/.test(sourceRepo.split("/")[1])
  )
    throw new Error("The pull request's source commit was unavailable.");
  if (sourceRepo !== repo) await publicRepo(sourceRepo);
  const { hash: commit } = await get(sourceRepo + "/commit/" + reportedCommit, {
    fields: "hash",
  });
  if (
    typeof commit !== "string" ||
    !/^[a-f\d]{40}$/i.test(commit) ||
    !commit.toLowerCase().startsWith(reportedCommit.toLowerCase())
  )
    throw new Error("Bitbucket did not resolve the full source commit.");
  const response = await get(sourceRepo + "/commit/" + commit + "/statuses", {
    pagelen: "10",
    fields: "values.key,values.state",
  });
  if (!Array.isArray(response.values))
    throw new Error("Bitbucket did not return commit statuses.");
  const statuses = response.values
    .filter(
      (item) =>
        item &&
        typeof item.key === "string" &&
        /^[\w. -]{1,80}$/.test(item.key) &&
        ["SUCCESSFUL", "FAILED", "INPROGRESS", "STOPPED"].includes(item.state),
    )
    .slice(0, 10)
    .map(({ key, state }) => ({ key, state }));
  const evidence = {
    url: "https://bitbucket.org/" + repo + "/pull-requests/" + id,
    commit,
    observedAt: new Date().toISOString(),
    statuses,
  };
  await writeFile(output, JSON.stringify(evidence, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    "Saved public pull request context with " +
      statuses.length +
      " build statuses.",
  );
}

try {
  await main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}

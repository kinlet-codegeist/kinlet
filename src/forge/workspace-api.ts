import "./workspace-demo";
import "./workspace-history";
import "./workspace-decision-impact";
import "./workspace-follow-up";
import { openWorkspaceReviews } from "./workspace-publication";
import { openQuestions } from "./workspace-runs";
import { command, resolver } from "./workspace-resolver";

command("workspace.attention", async (actor) => {
  const [work, questions] = await Promise.all([
    openWorkspaceReviews(actor),
    openQuestions(actor),
  ]);
  return { ...work, questions };
});

export const handler = resolver.getDefinitions();

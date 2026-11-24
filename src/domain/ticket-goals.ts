export const ticketGoalsOperation = "Kinlet_TicketGoals";

export const ticketGoalsQuery = `
  query ${ticketGoalsOperation}($issue: ID!) {
    jiraWorkItemGoals(id: $issue, first: 10) {
      edges {
        node {
          ... on AtlassianGoal { id name url }
        }
      }
      pageInfo { hasNextPage }
    }
  }
`;

type Goal = { id: string; name: string; url?: string };
type GoalResult = { goals: Goal[]; hasMore: boolean };
type GoalConnection = {
  edges?: Array<{ node?: Partial<Goal> | null } | null>;
  pageInfo?: { hasNextPage?: boolean };
};

function linkToGoal(raw: unknown) {
  if (typeof raw !== "string") return;
  try {
    const url = new URL(raw);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname.endsWith(".atlassian.com") ||
        url.hostname.endsWith(".atlassian.net"))
    )
      return url.href;
  } catch {
    // Goal names can still be displayed without a link.
  }
}

export function ticketGoalVariables(cloudId: string, issueId: string) {
  return { issue: `ari:cloud:jira:${cloudId}:issue/${issueId}` };
}

export function parseTicketGoals(result: {
  data?: Record<string, unknown> | null;
  errors?: unknown[] | null;
}): GoalResult {
  const connection = result.data?.jiraWorkItemGoals as
    GoalConnection | null | undefined;
  if (result.errors?.length || !Array.isArray(connection?.edges))
    throw new Error(
      "Teamwork Graph could not return the goals for this ticket.",
    );
  const goals = new Map<string, Goal>();
  for (const edge of connection.edges) {
    const goal = edge?.node;
    if (
      typeof goal?.id === "string" &&
      typeof goal.name === "string" &&
      goal.name.trim()
    )
      goals.set(goal.id, {
        id: goal.id,
        name: goal.name,
        url: linkToGoal(goal.url),
      });
  }
  return {
    goals: [...goals.values()],
    hasMore: connection.pageInfo?.hasNextPage === true,
  };
}

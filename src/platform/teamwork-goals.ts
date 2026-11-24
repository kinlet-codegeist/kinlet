import {
  parseTicketGoals,
  ticketGoalsQuery,
  ticketGoalVariables,
} from "../domain/ticket-goals";

export async function readTicketGoals(cloudId: string, issueId: string) {
  const { requestTeamworkGraph } = await import("@forge/bridge");
  return parseTicketGoals(
    await requestTeamworkGraph(
      ticketGoalsQuery,
      ticketGoalVariables(cloudId, issueId),
    ),
  );
}

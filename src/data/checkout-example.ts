// The fixed demo stops between the change to the specification and the later update to the Jira story.
export const checkoutExample = {
  key: "NOVA-102",
  summary: "Implement the checkout flow",
  before: "An account is required before payment.",
  after: "Customers can purchase without signing in.",
  payment: "Keep PayPal as the payment provider.",
  ticketBefore:
    "Require customers to sign in or create an account before taking payment. Preserve the existing payment provider and never store card details.",
  ticketAfter:
    "Build a checkout flow that supports guest purchases. Creating an account must be optional. Preserve the existing payment provider and never store card details.",
  title: "Checkout experience · product specification",
};

// Both drafts start at the same saved ticket. Applying one can put the other in conflict.
export const checkoutInboxDrafts = [
  {
    id: "e13c5b14-35ab-44d4-a79e-720b3e98681f",
    name: "Guest checkout for everyone",
    summary: "Open guest checkout to all shoppers",
    description: checkoutExample.ticketAfter,
    created: "2026-11-13T15:00:00Z",
  },
  {
    id: "4a2b7fab-264d-4a02-8e54-acc7ca8f486e",
    name: "Invite-only pilot",
    summary: "Pilot guest checkout with invited shoppers",
    description:
      "Let invited shoppers pay as guests. All other shoppers sign in before payment. Preserve the existing payment provider and never store card details.",
    created: "2026-11-13T15:15:00Z",
  },
].map(({ id, ...fields }) => ({
  ...fields,
  checkpointId: "1",
  revisionId: id,
  branchId: id,
  parentId: null,
  author: "Ricardo López (sample)",
}));

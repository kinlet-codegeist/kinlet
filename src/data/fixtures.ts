import { checkoutExample } from "./checkout-example";
import type { Artifact, WorkspaceState } from "../domain/types";

const date = "2026-11-13T10:42:00";
export function createInitialState(): WorkspaceState {
  const artifacts: Record<string, Artifact> = {
    epic: {
      id: "epic",
      key: "NOVA-100",
      kind: "issue",
      title: "A better checkout experience",
      description:
        "Make checkout faster, clearer, and more reliable. Let customers complete a purchase with confidence while preserving our payment and privacy policies.",
      status: "In progress",
      priority: "High",
      version: 4,
      updatedAt: date,
      owner: "Ricardo López",
      category: "Epic",
      editable: false,
    },
    checkout: {
      id: "checkout",
      key: checkoutExample.key,
      kind: "issue",
      title: checkoutExample.summary,
      description:
        checkoutExample.ticketAfter,
      status: "In progress",
      priority: "High",
      version: 7,
      updatedAt: date,
      owner: "Codex",
      category: "Story",
      editable: true,
    },
    payment: {
      id: "payment",
      key: "NOVA-103",
      kind: "issue",
      title: "Make payment retries predictable",
      description:
        "Show a clear failure message when a payment fails. Ask the customer to try again without creating a duplicate charge.",
      status: "In review",
      priority: "Medium",
      version: 3,
      updatedAt: date,
      owner: "Emma Wilson",
      category: "Task",
      editable: true,
    },
    events: {
      id: "events",
      key: "NOVA-104",
      kind: "issue",
      title: "Track checkout completion",
      description:
        "Capture anonymous checkout-started and checkout-completed events. Do not capture card information or personal data.",
      status: "To do",
      priority: "Medium",
      version: 2,
      updatedAt: date,
      owner: "Noah Kim",
      category: "Task",
      editable: true,
    },
    qa: {
      id: "qa",
      key: "NOVA-105",
      kind: "issue",
      title: "Validate the guest purchase journey",
      description:
        "Verify that a customer can complete a purchase without signing in, receive a receipt, and recover from a failed payment.",
      status: "To do",
      priority: "High",
      version: 3,
      updatedAt: date,
      owner: "Emma Wilson",
      category: "Task",
      editable: true,
    },
    design: {
      id: "design",
      key: "Checkout design",
      kind: "page",
      title: checkoutExample.title,
      description:
        `## What we are building\nA short, accessible checkout that supports guest purchases. An account is optional.\n\n## Acceptance criteria\n• ${checkoutExample.after}\n• ${checkoutExample.payment}\n• Show a receipt after a successful purchase.\n\n## Decision · November 13\nGuest checkout is now required. This replaces the earlier account-required approach.`,
      status: "Published",
      priority: "High",
      version: 7,
      updatedAt: date,
      owner: "Emma Wilson",
      category: "Specification",
      editable: true,
    },
    policy: {
      id: "policy",
      key: "Data policy",
      kind: "page",
      title: "Payment data & privacy principles",
      description:
        "## Our commitments\nNever store raw card details. Use the payment provider for sensitive data.\n\n## Analytics\nOnly anonymous journey events are permitted. No personal data in logs.\n\n## Retention\nKeep transaction references for the agreed retention period. This policy applies to every checkout approach.",
      status: "Published",
      priority: "High",
      version: 3,
      updatedAt: "2026-11-11T09:30:00",
      owner: "Ricardo López",
      category: "Policy",
      editable: false,
    },
  };
  const initial = structuredClone(artifacts);
  initial.checkout.description =
    checkoutExample.ticketBefore;
  initial.checkout.version = 6;
  initial.design.description =
    `## What we are building\nCheckout for signed-in customers. ${checkoutExample.before}\n\n## Acceptance criteria\n• Customers sign in or create an account.\n• ${checkoutExample.payment}\n• Show a receipt after a successful purchase.`;
  initial.design.version = 6;
  const accountDraft = structuredClone(initial);
  accountDraft.checkout.description =
    "Implement the account-first checkout. Redirect visitors to sign in before payment, use PayPal for payment authorization, and show a receipt after purchase. Add tests for account creation and sign-in.";
  accountDraft.design.description +=
    "\n\n## Implementation approach\nCreate an account-first checkout with a required authentication step and a PayPal payment screen.";
  const paymentDraft = structuredClone(artifacts);
  paymentDraft.payment.description +=
    "\n\nUse an idempotency key for each payment attempt. Allow up to three retries, show a clear status message, and preserve the original transaction reference.";
  return {
    schemaVersion: 1,
    workspaceName: "Nova Commerce",
    objective: "A faster checkout, with customers in control.",
    setupDone: true,
    artifacts,
    observedId: "C13",
    approvedId: "C12",
    budget: 10,
    dismissed: [],
    pinned: [],
    checkpoints: [
      {
        id: "C12",
        title: "Checkout scope approved",
        description:
          "Agreed checkout scope, implementation tasks, and payment policy. The starting point for the account-first exploration.",
        createdAt: "2026-11-12T15:20:00",
        author: "Ricardo López",
        kind: "baseline",
        artifacts: initial,
      },
      {
        id: "C13",
        title: "Guest checkout becomes a requirement",
        description:
          "Product updated the checkout specification and implementation story. Guest purchases are now required.",
        createdAt: date,
        author: "Emma Wilson",
        kind: "observation",
        artifacts: structuredClone(artifacts),
        parentId: "C12",
      },
    ],
    branches: [
      {
        id: "account-first",
        name: "Account-first checkout",
        objective: "Explore a clear checkout flow for signed-in customers.",
        baseId: "C12",
        revision: 3,
        draft: accountDraft,
        status: "review",
        createdAt: "2026-11-12T15:35:00",
        owner: "Codex",
        color: "violet",
        commitIds: [],
      },
      {
        id: "payment-retries",
        name: "Reliable payment retries",
        objective:
          "Avoid duplicate charges and make failed payments easy to recover from.",
        baseId: "C13",
        revision: 2,
        draft: paymentDraft,
        status: "review",
        createdAt: "2026-11-13T09:15:00",
        owner: "Emma Wilson",
        color: "teal",
        commitIds: [],
      },
    ],
    contexts: [
      {
        id: "ctx-084",
        branchId: "account-first",
        revision: 1,
        checkpointId: "C12",
        objective: "Implement the agreed checkout flow.",
        instructions:
          "Keep PayPal. Never store card details. Propose project changes for human review. Follow the captured specification.",
        sourceIds: ["checkout", "design", "policy"],
        createdAt: "2026-11-12T15:37:00",
        sources: structuredClone(initial),
      },
    ],
    runs: [
      {
        id: "run-084",
        provider: "Codex",
        title: "Build the checkout implementation plan",
        branchId: "account-first",
        checkpointId: "C12",
        contextId: "ctx-084",
        status: "review",
        createdAt: "2026-11-12T15:38:00",
        events: [
          {
            title: "Context supplied",
            description:
              "3 sources from C12, including the checkout specification and data policy.",
            time: "15:38",
            provenance: "recorded",
          },
          {
            title: "Implementation approach prepared",
            description:
              "Account-first checkout using the existing payment provider.",
            time: "15:42",
            provenance: "reported",
          },
          {
            title: "Branch draft saved",
            description:
              "Updated the implementation story and checkout specification.",
            time: "15:48",
            provenance: "recorded",
          },
          {
            title: "Proposal submitted",
            description: "2 artifact changes are ready for human review.",
            time: "15:51",
            provenance: "recorded",
          },
        ],
      },
      {
        id: "run-085",
        provider: "Claude",
        title: "Review payment recovery behavior",
        branchId: "payment-retries",
        checkpointId: "C13",
        status: "waiting",
        createdAt: "2026-11-13T09:25:00",
        events: [
          {
            title: "Review started",
            description: "Checking retry behavior and provider constraints.",
            time: "09:25",
            provenance: "reported",
          },
          {
            title: "Decision requested",
            description: "Confirm whether PayPal remains the payment provider.",
            time: "09:31",
            provenance: "recorded",
          },
        ],
      },
    ],
    proposals: [
      {
        id: "proposal-24",
        title: "Checkout implementation plan",
        summary:
          "An account-first implementation plan with a documented payment flow. The source specification has changed since this work started.",
        branchId: "account-first",
        runId: "run-084",
        checkpointId: "C12",
        createdAt: "2026-11-12T15:51:00",
        status: "submitted",
        resolutions: {},
        changes: [
          {
            id: "change-1",
            artifactId: "checkout",
            field: "description",
            before: initial.checkout.description,
            after: accountDraft.checkout.description,
          },
          {
            id: "change-2",
            artifactId: "design",
            field: "description",
            before: initial.design.description,
            after: accountDraft.design.description,
          },
        ],
      },
      {
        id: "proposal-25",
        title: "Safer payment retry behavior",
        summary:
          "Keep retry attempts tied to one transaction so customers are never charged twice.",
        branchId: "payment-retries",
        checkpointId: "C13",
        createdAt: "2026-11-13T10:10:00",
        status: "submitted",
        resolutions: {},
        changes: [
          {
            id: "change-3",
            artifactId: "payment",
            field: "description",
            before: artifacts.payment.description,
            after: paymentDraft.payment.description,
          },
        ],
      },
    ],
    publications: [],
    questions: [
      {
        id: "question-provider",
        title: "Keep PayPal for guest checkout?",
        description:
          "The review agent needs a provider decision before continuing its payment recovery work.",
        runId: "run-085",
      },
    ],
    activities: [
      {
        id: "activity-1",
        title: "Guest checkout requirement added",
        detail: "Emma updated the specification · C13",
        at: date,
        kind: "checkpoint",
      },
      {
        id: "activity-2",
        title: "Payment recovery proposal is ready",
        detail: "Emma · Reliable payment retries",
        at: "2026-11-13T10:10:00",
        kind: "review",
      },
      {
        id: "activity-3",
        title: "Codex submitted a proposal",
        detail: "Account-first checkout · based on C12",
        at: "2026-11-12T15:51:00",
        kind: "run",
      },
    ],
    flags: { aiUnavailable: false, accessLost: false, partialPublish: false },
    settings: {
      reviewer: "Ricardo López",
      retention: "Keep saved history",
      theme: "light",
    },
  };
}

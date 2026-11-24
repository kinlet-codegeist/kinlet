import { expect, test } from "@playwright/test";
import { checkoutExample } from "../src/data/checkout-example";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.removeItem("checkpoint.visual-prototype.v1"),
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Attention" })).toBeVisible();
});
test("all primary screens render without runtime errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [route, title] of [
    ["/project", "Project overview"],
    ["/history", "Project history"],
    ["/branches", "Branches"],
    ["/reviews", "Reviews"],
    ["/sessions", "Agent sessions"],
    ["/settings", "Settings"],
  ]) {
    await page.goto(`/#${route}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  expect(errors).toEqual([]);
});
test("complete checkpoint, editable branch, context, sample agent, and publication flow", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  await page.getByLabel("Checkpoint name").fill("Before our guest experiment");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Before our guest experiment" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Branch from here" }).click();
  await page.getByLabel("Branch name").fill("Guest flow experiment");
  await page
    .getByLabel("What are you exploring?")
    .fill("Implement a clear guest checkout");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create branch", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Guest flow experiment", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Artifact title")
    .fill("Checkout with a welcoming guest journey");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("link", { name: "Prepare agent context", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Prepare context", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Context pack prepared" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Run sample agent", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Guest checkout implementation",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve & publish", exact: true })
    .click();
  await page.getByRole("button", { name: /Publish 2 sample records/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Selected sample changes are published",
    }),
  ).toBeVisible();
  await expect(page.locator(".receipt-step.verified")).toHaveCount(2);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Selected sample changes are published",
    }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("checkpoint.visual-prototype.v1")!),
  );
  expect(saved.artifacts.checkout.title).toBe(
    "Checkout with a welcoming guest journey",
  );
  expect(saved.artifacts.checkout.description).toContain("guest");
  expect(saved.approvedId).toBe("C12");
});
test("changed requirements require an explicit review and retain historical evidence", async ({
  page,
}) => {
  const original = checkoutExample.ticketBefore;
  await page
    .getByRole("button", { name: "Review the changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve & publish", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Adapt sample to guest checkout" })
    .click();
  await expect(
    page.getByText("Selected differences are resolved.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve & publish", exact: true })
    .click();
  await page.getByRole("button", { name: /Publish 2 sample records/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Selected sample changes are published",
    }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("checkpoint.visual-prototype.v1")!),
  );
  expect(
    saved.checkpoints.find((c: { id: string }) => c.id === "C12").artifacts
      .checkout.description,
  ).toBe(original);
  expect(saved.artifacts.checkout.description).toContain("guest purchases");
});
test("partial publication verifies remaining work without repeating successful updates", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Sample workspace", exact: true })
    .click();
  await page
    .getByRole("switch", { name: /Interrupt the next publication/ })
    .check();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Review the changes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Adapt sample to guest checkout" })
    .click();
  await expect(
    page.getByText("Selected differences are resolved.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve & publish", exact: true })
    .click();
  await page.getByRole("button", { name: /Publish 2 sample records/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "The remaining update needs verification",
    }),
  ).toBeVisible();
  await expect(page.locator(".receipt-step.verified")).toHaveCount(1);
  const version = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("checkpoint.visual-prototype.v1")!)
        .artifacts.checkout.version,
  );
  await page.getByRole("button", { name: "Verify & continue sample" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Selected sample changes are published",
    }),
  ).toBeVisible();
  await expect(page.locator(".receipt-step.verified")).toHaveCount(2);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("checkpoint.visual-prototype.v1")!)
          .artifacts.checkout.version,
    ),
  ).toBe(version);
});
test("fresh setup can track Jira only and saves a genuine first sample checkpoint", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Sample workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "Start from setup" }).click();
  await page.getByRole("checkbox", { name: /Confluence/ }).uncheck();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Workspace name").fill("My focused workspace");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Save first checkpoint" }).click();
  await expect(
    page.getByRole("heading", { name: "Our first shared checkpoint" }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("checkpoint.visual-prototype.v1")!),
  );
  expect(saved.checkpoints).toHaveLength(1);
  expect(saved.observedId).toBe("C1");
  expect(
    Object.values(saved.artifacts).every((a: any) => a.kind === "issue"),
  ).toBe(true);
  expect(saved.branches).toHaveLength(0);
});
test("attention budget changes selection and mobile screens stay within the viewport", async ({
  page,
}) => {
  await page.getByLabel("Available attention budget").selectOption("5");
  await expect(
    page.getByText(/1 more decision outside this focus window/),
  ).toBeVisible();
  await page.getByText(/1 more decision outside this focus window/).click();
  await expect(
    page.getByRole("button", { name: "Review the changes", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 430, height: 932 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(430);
  await page.goto("/#/reviews/proposal-24");
  await expect(
    page.getByRole("heading", {
      name: "Checkout implementation plan",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(430);
});

test("unavailable AI preserves the manual review path and source restrictions are visible", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Sample workspace", exact: true })
    .click();
  await page.getByRole("switch", { name: /AI unavailable/ }).check();
  await page
    .getByRole("switch", { name: /A source becomes unavailable/ })
    .check();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.goto("/#/branches/account-first/context");
  await page
    .getByRole("button", { name: "Prepare context", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Sample agent responses are turned off.",
  );
  await page.goto("/#/reviews/proposal-24");
  await expect(
    page.getByText(
      "AI is unavailable in this scenario. The exact comparison and manual choices still work.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep current", exact: true }).click();
  await page.getByRole("button", { name: "Next change", exact: true }).click();
  await page.getByRole("button", { name: "Keep current", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve & publish", exact: true }),
  ).toBeEnabled();
  await page.goto("/#/project");
  await page.getByRole("button", { name: /Unavailable source/ }).click();
  await expect(
    page.getByRole("heading", { name: "Source unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByText("Content is not available.", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

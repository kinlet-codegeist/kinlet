import { expect, it } from "vitest";
import { assertDemoBootstrap } from "../platform/contracts";
import { handler } from "./index";

it("serves the bootstrap contract through the registered Forge resolver", async () => {
  const response = await handler({
    call: { functionKey: "getBootstrap" },
    context: {},
  });
  assertDemoBootstrap(response);
  expect(
    response.workspace.checkpoints.map((checkpoint) => checkpoint.id),
  ).toContain("C12");
  expect(response.workspace.workspaceName).toBe("Nova Commerce");
});

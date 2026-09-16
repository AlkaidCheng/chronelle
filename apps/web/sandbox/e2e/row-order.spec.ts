import { expect, test } from "@playwright/test";
import { createRecoveryEvent } from "../../e2e/helpers/event-draft-recovery";
import { exerciseRowOrder } from "../../e2e/helpers/row-order";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("reorders task rows offline by drag and from the row menu", async ({
  page,
  context,
}) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await createRecoveryEvent(page);
  await exerciseRowOrder(page);
  expect(errors).toEqual([]);
});

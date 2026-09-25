import { expect, test } from "@playwright/test";
import { createRecoveryEvent } from "../../e2e/helpers/event-draft-recovery";
import { exerciseObjectRecovery } from "../../e2e/helpers/object-draft-recovery";

const sandboxUrl = new URL(
  "../../../../.livtales/sandbox/livtales.html",
  import.meta.url,
).href;

for (const kind of ["task", "expense", "reminder"] as const)
  test(`recovers ${kind} creation and edits through offline browser navigation`, async ({
    page,
    context,
  }, testInfo) => {
    await context.setOffline(true);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(sandboxUrl);
    await createRecoveryEvent(page);
    await exerciseObjectRecovery(page, testInfo, kind);
    expect(errors).toEqual([]);
  });

import { expect, test } from "@playwright/test";
import { createRecoveryEvent } from "../../e2e/helpers/event-draft-recovery";
import {
  expectCreatedSchedule,
  prepareScheduleCreation,
} from "../../e2e/helpers/schedule-creation";
import {
  inspectScheduleRecovery,
  reopenScheduleDraft,
} from "../../e2e/helpers/schedule-draft-recovery";
import { openEventView } from "../../e2e/helpers/event-view";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("recovers and explicitly discards schedule drafts through offline navigation", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await createRecoveryEvent(page);
  await prepareScheduleCreation(page, testInfo);
  await reopenScheduleDraft(page);
  await inspectScheduleRecovery(page, testInfo);
  await page
    .getByLabel("Schedule item", { exact: true })
    .press("ControlOrMeta+Enter");
  await expectCreatedSchedule(page);
  await openEventView(page, "Calendar");
  await page
    .getByRole("button", { name: "Add schedule item", exact: true })
    .click();
  await page
    .getByLabel("Schedule item", { exact: true })
    .fill("Discarded arrival");
  await reopenScheduleDraft(page);
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add schedule item", exact: true })
    .click();
  await expect(page.getByLabel("Schedule item", { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByLabel("Schedule item", { exact: true })
    .fill("Reload clears this draft");
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await page
    .getByRole("button", { name: "Add schedule item", exact: true })
    .click();
  await expect(page.getByLabel("Schedule item", { exact: true })).toHaveValue(
    "",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Garden arrival", exact: true }),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});

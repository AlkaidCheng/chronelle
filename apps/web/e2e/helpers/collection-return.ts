import { expect, type Page, type TestInfo } from "@playwright/test";
import {
  chooseEventFilter,
  chooseEventLayout,
  chooseEventSort,
  openSearchPage,
} from "./quiet-chrome";

export async function exerciseCollectionReturn(
  page: Page,
  testInfo: TestInfo,
  name: string,
  total: number,
) {
  const input = page.getByLabel("Filter events by name");
  await input.fill(name);
  await chooseEventSort(page, "Name A-Z");
  await chooseEventFilter(page, "Unscheduled");
  await chooseEventLayout(page, "List");
  const count = page.getByRole("status", { name: "Event count" });
  await expect(count).toHaveText(
    `${Math.min(total, 20)} ${total === 1 ? "event" : "events"} loaded`,
  );
  if (total > 20)
    await page.getByRole("button", { name: "Load more events" }).click();
  await expect(count).toHaveText(
    `${total} ${total === 1 ? "event" : "events"} loaded`,
  );
  const card = page.locator(".event-card").last();
  const title = await card.locator("h2").innerText();
  const href = await card.getAttribute("href");
  await card.focus();
  const top = await card.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "All events", exact: true }).click();

  async function expectReturn() {
    await expect(input).toHaveValue(name);
    await expect(
      page.getByRole("button", { name: "Sort events" }),
    ).toHaveAttribute("data-value", "name");
    await expect(
      page.getByRole("button", { name: "Event layout", exact: true }),
    ).toHaveAttribute("data-value", "list");
    await expect(
      page.getByRole("button", { name: "Filter events", exact: true }),
    ).toHaveAttribute("data-value", "unscheduled");
    await expect(count).toHaveText(
      `${total} ${total === 1 ? "event" : "events"} loaded`,
    );
    await expect(card).toHaveAttribute("href", href ?? "");
    await expect(card).toBeFocused();
    await expect
      .poll(async () =>
        Math.abs(
          (await card.evaluate(
            (element) => element.getBoundingClientRect().top,
          )) - top,
        ),
      )
      .toBeLessThan(3);
    expect(page.url()).not.toContain(encodeURIComponent(name));
  }
  await expectReturn();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expectReturn();
  await page.screenshot({
    path: testInfo.outputPath("collection-return.png"),
    animations: "disabled",
  });

  await input.fill("No matching private plans");
  await expect(
    page.getByText("No matching events", { exact: true }),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", {
    name: "Workspace navigation",
  });
  await openSearchPage(page);
  await navigation.getByRole("link", { name: "Events", exact: true }).click();
  await expect(input).toHaveValue("No matching private plans");
  await expect(
    page.getByText("No matching events", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(input).toHaveValue("");
  await input.fill(name);
  await page.reload();
  await expect(input).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Sort events" }),
  ).toHaveAttribute("data-value", "date");
}

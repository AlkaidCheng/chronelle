import { expect, type Page, type TestInfo } from "@playwright/test";

export async function exerciseCollectionReturn(
  page: Page,
  testInfo: TestInfo,
  name: string,
  total: number,
) {
  const input = page.getByLabel("Filter events by name");
  await input.fill(name);
  await page.getByLabel("Sort events").selectOption("name");
  await page.getByRole("button", { name: "unscheduled", exact: true }).click();
  await page.getByRole("button", { name: "List view", exact: true }).click();
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
    await expect(page.getByLabel("Sort events")).toHaveValue("name");
    await expect(
      page.getByRole("button", { name: "List view", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "unscheduled", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
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
  await navigation.getByRole("link", { name: "Search", exact: true }).click();
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
  await expect(page.getByLabel("Sort events")).toHaveValue("date");
}

import { expect, test } from "@playwright/test";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("standalone screens work offline and preserve browser edits", async ({
  page,
  context,
}, testInfo) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await context.setOffline(true);
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await expect(
    page.getByRole("heading", { name: "Autumn gathering", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("event-overview.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Calendar", exact: true }).click();
  await expect(
    page.getByText("Welcome and coffee", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Layout", exact: false }).click();
  await page
    .getByRole("menuitemradio", { name: "Agenda", exact: true })
    .click();
  await expect(
    page.getByText("Welcome and coffee", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Preview role").selectOption("viewer");
  await expect(
    page.getByRole("button", { name: "Edit event", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Preview role").selectOption("owner");
  await page.getByRole("link", { name: "Events", exact: true }).first().click();
  await page.getByRole("button", { name: "New event", exact: true }).click();
  await page
    .getByLabel("Event name", { exact: true })
    .fill("Sandbox design review");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sandbox design review", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sandbox design review", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Updated design review");
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Updated design review", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("reset is explicit and content policy blocks external connections", async ({
  page,
}) => {
  await page.goto(sandboxUrl);
  await page.evaluate(() =>
    localStorage.setItem("chronelle.design-sandbox.v1", "unreadable"),
  );
  await page.reload();
  await page.getByText("Sandbox limits", { exact: true }).click();
  await expect(
    page.getByText(/Saved sandbox data is unreadable/),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Reset sample data" }).click();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("chronelle.design-sandbox.v1"),
    ),
  ).toBe("unreadable");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset sample data" }).click();
  await expect(
    page.getByRole("link", { name: /Autumn gathering/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("chronelle.design-sandbox.v1"),
    ),
  ).not.toBe("unreadable");
  expect(
    await page.evaluate(async () => {
      const violation = new Promise<string>((resolve) =>
        document.addEventListener(
          "securitypolicyviolation",
          (event) => resolve(event.effectiveDirective),
          { once: true },
        ),
      );
      void fetch("https://example.test/blocked").catch(() => undefined);
      return violation;
    }),
  ).toBe("connect-src");
});

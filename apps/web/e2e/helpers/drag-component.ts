import { expect, type Locator, type Page } from "@playwright/test";

/** Start the native drag before scrolling to a distant drop target. */
export async function dragComponent(
  page: Page,
  handle: Locator,
  target: Locator,
) {
  await handle.scrollIntoViewIfNeeded();
  const source = await handle.boundingBox();
  if (!source) throw new Error("Drag handle is not visible");
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    source.x + source.width / 2 + 8,
    source.y + source.height / 2,
    { steps: 3 },
  );
  await expect(page.locator(".component-drop-end")).toBeAttached();
  await target.scrollIntoViewIfNeeded();
  const destination = await target.boundingBox();
  if (!destination) throw new Error("Drop target is not visible");
  await page.mouse.move(destination.x + 10, destination.y + 10, { steps: 5 });
  await page.mouse.move(destination.x + 12, destination.y + 12);
  await page.mouse.up();
  await expect(page.locator(".component-drop-end")).toHaveCount(0);
}

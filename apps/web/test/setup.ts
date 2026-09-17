import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

if (typeof HTMLElement !== "undefined")
  HTMLElement.prototype.scrollIntoView = vi.fn();

// Components read their strings from the provider; render and renderHook
// supply it with English so existing assertions keep their wording.
vi.mock("@testing-library/react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@testing-library/react")>();
  const { withIntl } = await import("./intl");
  const render = (
    ui: Parameters<typeof actual.render>[0],
    options?: Parameters<typeof actual.render>[1],
  ) => actual.render(ui, { ...options, wrapper: withIntl(options?.wrapper) });
  const renderHook = (
    hook: Parameters<typeof actual.renderHook>[0],
    options?: Parameters<typeof actual.renderHook>[1],
  ) =>
    actual.renderHook(hook, {
      ...options,
      wrapper: withIntl(options?.wrapper),
    });
  return { ...actual, render, renderHook };
});

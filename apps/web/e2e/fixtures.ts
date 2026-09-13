import { test as base } from "@playwright/test";

export { expect, type APIRequestContext, type Page } from "@playwright/test";

export const test = base.extend({
  request: async ({ playwright, extraHTTPHeaders }, use) => {
    // Verification requests may be separated by a long interactive journey.
    const request = await playwright.request.newContext({
      extraHTTPHeaders: { ...extraHTTPHeaders, connection: "close" },
    });
    try {
      await use(request);
    } finally {
      await request.dispose();
    }
  },
});

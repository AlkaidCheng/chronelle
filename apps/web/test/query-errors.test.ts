import { ApiClientError } from "@chronelle/api-client";
import { describe, expect, it } from "vitest";
import { isTemporaryReadError } from "../lib/query-errors";

describe("temporary read failures", () => {
  it.each([0, 408, 429, 500, 503, 599])(
    "recognizes transient status %s",
    (status) => {
      expect(
        isTemporaryReadError(
          new ApiClientError(
            status,
            status === 0 ? "network_error" : "unavailable",
            "Unavailable",
          ),
        ),
      ).toBe(true);
    },
  );

  it.each([400, 401, 403, 404, 409, 410, 422, 600])(
    "does not retain protected data for status %s",
    (status) => {
      expect(
        isTemporaryReadError(
          new ApiClientError(status, "network_error", "Unavailable"),
        ),
      ).toBe(false);
    },
  );

  it("fails closed for unexpected or malformed errors", () => {
    for (const error of [
      null,
      new Error("Unknown"),
      new ApiClientError(0, "invalid_response", "Invalid"),
    ]) {
      expect(isTemporaryReadError(error)).toBe(false);
    }
  });
});

// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@chronelle/api-client";

import { ErrorNotice } from "../components/feedback";

describe("ErrorNotice", () => {
  it("offers a refresh action for optimistic concurrency conflicts", async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    render(
      <ErrorNotice
        error={
          new ApiClientError(409, "version_conflict", "Refresh before editing.")
        }
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "A newer version is available",
    );
    await user.click(screen.getByRole("button", { name: "Refresh latest" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("offers a retry action for recoverable request failures", async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    render(
      <ErrorNotice
        error={new Error("Temporary failure.")}
        onRefresh={onRefresh}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});

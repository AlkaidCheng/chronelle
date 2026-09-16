// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@chronelle/api-client";

import { DraftNotice, ErrorNotice, Notice } from "../components/feedback";

afterEach(cleanup);

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

describe("Notice", () => {
  it("reads a neutral status by default, with an icon beside the text", () => {
    render(<Notice>Saved versions follow current access.</Notice>);
    const notice = screen.getByRole("status");
    expect(notice).toHaveAttribute("data-tone", "neutral");
    expect(notice).toHaveClass("notice", "notice-neutral");
    expect(notice.querySelector(".notice-mark svg")).not.toBeNull();
    expect(notice).toHaveTextContent("Saved versions follow current access.");
  });

  it("marks a completed action as success and an error as danger", () => {
    render(
      <>
        <Notice tone="success">Link recovered.</Notice>
        <Notice tone="danger">The link could not be recovered.</Notice>
      </>,
    );
    const success = screen.getByRole("status");
    expect(success).toHaveAttribute("data-tone", "success");
    expect(success).toHaveClass("notice-success");
    expect(success).not.toHaveClass("notice-danger");
    const danger = screen.getByRole("alert");
    expect(danger).toHaveAttribute("data-tone", "danger");
    expect(danger).toHaveClass("notice-danger");
  });

  it("gives request failures the danger tone and version conflicts the warning tone", () => {
    render(
      <>
        <ErrorNotice error={new Error("Temporary failure.")} />
        <DraftNotice onLoadLatest={vi.fn()} />
      </>,
    );
    expect(screen.getByRole("alert")).toHaveAttribute("data-tone", "danger");
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "warning");
    expect(screen.getByRole("status")).toHaveTextContent(
      "A newer version is available",
    );
  });
});

// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@chronelle/api-client";

import { EditorControls } from "../features/events/editor-controls";

function controls() {
  return {
    draft: { hasNewerVersion: false, loadLatest: vi.fn() },
    mutation: {
      isPending: false,
      isError: false,
      isSuccess: false,
      error: new ApiClientError(409, "version_conflict", "Changed elsewhere"),
      reset: vi.fn(),
    },
    submitLabel: "Save item",
  };
}

afterEach(cleanup);

describe("EditorControls", () => {
  it("resets a conflict after refresh without discarding the draft", async () => {
    const props = controls();
    props.mutation.isError = true;
    let finish: (() => void) | undefined;
    const onRefresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<EditorControls {...props} onRefresh={onRefresh} />);
    await user.click(screen.getByRole("button", { name: "Refresh latest" }));
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(props.mutation.reset).not.toHaveBeenCalled();
    expect(props.draft.loadLatest).not.toHaveBeenCalled();
    const refreshing = screen.getByRole("button", { name: "Refreshing..." });
    expect(refreshing).toBeDisabled();
    await user.click(refreshing);
    expect(onRefresh).toHaveBeenCalledOnce();
    await act(async () => finish?.());
    expect(props.mutation.reset).toHaveBeenCalledOnce();
    expect(props.draft.loadLatest).not.toHaveBeenCalled();
  });

  it("loads the latest draft before resetting the error", async () => {
    const props = controls();
    props.draft.hasNewerVersion = true;
    const order: string[] = [];
    props.draft.loadLatest.mockImplementation(() => {
      order.push("load");
    });
    props.mutation.reset.mockImplementation(() => {
      order.push("reset");
    });
    const user = userEvent.setup();
    render(<EditorControls {...props} />);
    expect(screen.getByRole("button", { name: "Save item" })).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Discard draft and load latest" }),
    );
    expect(order).toEqual(["load", "reset"]);
  });

  it("does not reset a newer save when an earlier refresh finishes", async () => {
    const props = controls();
    props.mutation.isError = true;
    let finish: (() => void) | undefined;
    const onRefresh = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    const user = userEvent.setup();
    const view = render(<EditorControls {...props} onRefresh={onRefresh} />);
    await user.click(screen.getByRole("button", { name: "Refresh latest" }));
    view.rerender(
      <EditorControls
        {...props}
        mutation={{
          ...props.mutation,
          isError: false,
          isPending: true,
          error: null,
        }}
        onRefresh={onRefresh}
      />,
    );
    await act(async () => finish?.());
    expect(props.mutation.reset).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  });

  it("retains the save error and draft when a refresh fails, then allows another refresh", async () => {
    const props = controls();
    props.mutation.isError = true;
    const onRefresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("Refresh unavailable"))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<EditorControls {...props} onRefresh={onRefresh} />);
    await user.click(screen.getByRole("button", { name: "Refresh latest" }));
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getByText("Refresh unavailable")).toBeVisible();
    expect(props.mutation.reset).not.toHaveBeenCalled();
    expect(props.draft.loadLatest).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Refresh latest" }));
    expect(props.mutation.reset).toHaveBeenCalledOnce();
    expect(screen.queryByText("Refresh unavailable")).toBeNull();
  });

  it("labels a non-conflict refresh as a read, not a save retry", () => {
    const props = controls();
    render(
      <EditorControls
        {...props}
        mutation={{
          ...props.mutation,
          isError: true,
          error: new Error("Save unavailable"),
        }}
        onRefresh={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Refresh latest" }),
    ).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByText(/Refreshing only checks/)).toBeVisible();
  });

  it("supports keyboard cancellation and disables save and cancel while pending", async () => {
    const props = controls();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const view = render(<EditorControls {...props} onCancel={onCancel} />);
    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onCancel).toHaveBeenCalledOnce();
    view.rerender(
      <EditorControls
        {...props}
        mutation={{ ...props.mutation, isPending: true }}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows creation errors without offering a resource refresh", () => {
    const props = controls();
    render(
      <EditorControls
        {...props}
        mutation={{
          ...props.mutation,
          isError: true,
          error: new Error("Creation failed"),
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Creation failed");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Save item" })).toBeEnabled();
  });
});

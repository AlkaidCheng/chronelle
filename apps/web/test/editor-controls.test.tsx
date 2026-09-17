// @vitest-environment jsdom

import { ApiClientError } from "@chronelle/api-client";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorControls } from "../features/events/editor-controls";

// The comparison itself is covered with the forms; here only its three
// ways out matter.
// The controls invalidate the lists behind the editor after a refresh; the
// query cache is not under test here.
vi.mock("../lib/queries", () => ({
  useCanonicalInvalidation: () => () => Promise.resolve(),
}));

vi.mock("../features/events/conflict-notice", () => ({
  ConflictNotice: (props: {
    onKeepMine: () => void;
    onMerge: (fields: Record<string, string>) => void;
    onTakeTheirs: () => void;
  }) => (
    <div>
      <button onClick={props.onTakeTheirs} type="button">
        Take theirs
      </button>
      <button onClick={props.onKeepMine} type="button">
        Keep mine
      </button>
      <button onClick={() => props.onMerge({ name: "merged" })} type="button">
        Save merged version
      </button>
    </div>
  ),
}));

function controls() {
  return {
    conflict: { objectId: "019d6e7d-0000-7000-8000-000000000101" },
    draft: {
      fields: { name: "mine" },
      baseline: { name: "base" },
      theirs: { name: "theirs" },
      hasNewerVersion: false,
      loadLatest: vi.fn(),
      rebase: vi.fn(),
    },
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
  it("reads the newest version after a stale save, and clears the refusal only on the person's own refresh", async () => {
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
    // The stale save starts the read by itself.
    expect(onRefresh).toHaveBeenCalledOnce();
    const refreshing = screen.getByRole("button", { name: "Refreshing..." });
    expect(refreshing).toBeDisabled();
    await act(async () => finish?.());
    expect(props.mutation.reset).not.toHaveBeenCalled();
    expect(props.draft.loadLatest).not.toHaveBeenCalled();
    // No newer version arrived: the refusal stands with the draft. The
    // person's own refresh clears it.
    await user.click(screen.getByRole("button", { name: "Refresh latest" }));
    expect(onRefresh).toHaveBeenCalledTimes(2);
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
    await user.click(screen.getByRole("button", { name: "Take theirs" }));
    expect(order).toEqual(["load", "reset"]);
  });

  it("pins the draft to the newest version and submits for Keep mine and a merge", async () => {
    const props = controls();
    props.draft.hasNewerVersion = true;
    const submit = vi.fn((event: { preventDefault: () => void }) =>
      event.preventDefault(),
    );
    const user = userEvent.setup();
    const view = render(
      <form onSubmit={submit}>
        <EditorControls {...props} />
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(props.draft.rebase).toHaveBeenCalledWith({ name: "mine" });
    expect(props.mutation.reset).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    view.rerender(
      <form onSubmit={submit}>
        <EditorControls
          {...props}
          draft={{ ...props.draft, hasNewerVersion: false }}
        />
      </form>,
    );
    expect(submit).toHaveBeenCalledOnce();

    view.rerender(
      <form onSubmit={submit}>
        <EditorControls
          {...props}
          draft={{ ...props.draft, hasNewerVersion: true }}
        />
      </form>,
    );
    await user.click(
      screen.getByRole("button", { name: "Save merged version" }),
    );
    expect(props.draft.rebase).toHaveBeenLastCalledWith({ name: "merged" });
    view.rerender(
      <form onSubmit={submit}>
        <EditorControls
          {...props}
          draft={{ ...props.draft, hasNewerVersion: false }}
        />
      </form>,
    );
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("does not reset a newer save when an earlier refresh finishes", async () => {
    const props = controls();
    props.mutation.isError = true;
    let finish: (() => void) | undefined;
    const onRefresh = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    const view = render(<EditorControls {...props} onRefresh={onRefresh} />);
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
    // The stale save fetches the newest version by itself; that read fails.
    expect(await screen.findByText("Refresh unavailable")).toBeVisible();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
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

// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useEditorDraft } from "../lib/use-editor-draft";

interface Resource {
  readonly id: string;
  readonly version: number;
  readonly displayName: string;
}

const initial: Resource = { id: "first", version: 1, displayName: "Initial" };
const initialize = (source: Resource | undefined) => ({
  displayName: source?.displayName ?? "",
  amount: "",
  currency: "USD",
});

afterEach(cleanup);

describe("useEditorDraft", () => {
  it("recovers fields with the original baseline and version, not a newer revision", () => {
    const baseline = initialize(initial);
    const recovered = {
      source: initial,
      baseline,
      fields: { ...baseline, displayName: "Kept draft" },
    };
    const latest = { ...initial, version: 2, displayName: "Collaborator" };
    const { result, rerender } = renderHook(
      (resource: Resource) => useEditorDraft(resource, initialize, recovered),
      { initialProps: latest },
    );
    expect(result.current.snapshot).toBe(recovered);
    expect(result.current.isDirty).toBe(true);
    expect(result.current.hasNewerVersion).toBe(true);
    act(() => result.current.loadLatest());
    expect(result.current.fields.displayName).toBe("Collaborator");
    expect(result.current.isDirty).toBe(false);
    rerender({ ...latest, id: "different", displayName: "Another event" });
    expect(result.current.fields.displayName).toBe("Another event");
    expect(result.current.isDirty).toBe(false);
  });

  it("compares flat fields with their loaded baseline", () => {
    const { result } = renderHook(() => useEditorDraft(initial, initialize));
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.change({ displayName: "Draft" }));
    expect(result.current.isDirty).toBe(true);
    act(() => result.current.change({ displayName: "Initial" }));
    expect(result.current.isDirty).toBe(false);
    act(() =>
      result.current.accept({ ...initial, version: 2, displayName: "Saved" }),
    );
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.change({ currency: "EUR" }));
    expect(result.current.isDirty).toBe(true);
    act(() => result.current.loadLatest());
    expect(result.current.isDirty).toBe(false);
  });
  it("preserves fields through background updates and explicitly accepts the latest", () => {
    const { result, rerender } = renderHook(
      (latest: Resource) => useEditorDraft(latest, initialize),
      { initialProps: initial },
    );
    act(() => result.current.change({ displayName: "Draft", currency: "EUR" }));
    const latest = { ...initial, version: 2, displayName: "Collaborator" };
    rerender(latest);
    expect(result.current.source).toBe(initial);
    expect(result.current.fields).toEqual({
      displayName: "Draft",
      amount: "",
      currency: "EUR",
    });
    expect(result.current.hasNewerVersion).toBe(true);
    act(() => result.current.loadLatest());
    expect(result.current.source).toBe(latest);
    expect(result.current.fields).toEqual(initialize(latest));
    expect(result.current.hasNewerVersion).toBe(false);
  });

  it("accepts saved fields and version while parent data is behind", () => {
    const { result, rerender } = renderHook(
      (latest: Resource) => useEditorDraft(latest, initialize),
      { initialProps: initial },
    );
    const saved = { ...initial, version: 2, displayName: "Saved" };
    act(() => result.current.accept(saved));
    act(() => result.current.change({ displayName: "Next draft" }));
    rerender({ ...initial });
    expect(result.current.source).toBe(saved);
    expect(result.current.fields.displayName).toBe("Next draft");
    rerender({ ...saved });
    expect(result.current.fields.displayName).toBe("Next draft");
    expect(result.current.hasNewerVersion).toBe(false);
  });

  it("resets fields and source together when switching objects or entering creation", () => {
    const { result, rerender } = renderHook(
      (latest: Resource | undefined) => useEditorDraft(latest, initialize),
      { initialProps: initial as Resource | undefined },
    );
    act(() =>
      result.current.change({ displayName: "First draft", currency: "EUR" }),
    );
    const second = { ...initial, id: "second", displayName: "Second" };
    rerender(second);
    expect(result.current.source).toBe(second);
    expect(result.current.fields).toEqual(initialize(second));
    rerender(undefined);
    expect(result.current.source).toBeUndefined();
    expect(result.current.fields).toEqual(initialize(undefined));
    rerender(initial);
    expect(result.current.source).toBe(initial);
    expect(result.current.fields).toEqual(initialize(initial));
  });

  it("merges queued field changes and partial creation resets without reinitializing", () => {
    const createFields = vi.fn(initialize);
    const { result, rerender } = renderHook(() =>
      useEditorDraft(undefined, createFields),
    );
    act(() => {
      result.current.change({ displayName: "Deposit", amount: "12.3400" });
      result.current.change({ currency: "EUR" });
    });
    expect(result.current.fields).toEqual({
      displayName: "Deposit",
      amount: "12.3400",
      currency: "EUR",
    });
    act(() => result.current.change({ displayName: "", amount: "" }));
    rerender();
    expect(result.current.fields).toEqual({
      displayName: "",
      amount: "",
      currency: "EUR",
    });
    expect(createFields).toHaveBeenCalledOnce();
  });
});

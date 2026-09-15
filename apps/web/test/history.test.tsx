// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Providers } from "../app/providers";
import { HistoryButton } from "../features/history/history-button";

const id = "019d6e7d-0000-7000-8000-000000000010";
const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const sourceId = "019d6e7d-0000-7000-8000-000000000012";
const change = {
  field: "displayName",
  label: "Name",
  valueType: "text",
  before: "Current",
  after: "Original",
  beforePresent: true,
  afterPresent: true,
  restorable: true,
};
const summary = (version: number) => ({
  id: `019d6e7d-0000-7000-8000-${String(version).padStart(12, "0")}`,
  objectId: id,
  objectVersion: version,
  mutationKind: version === 1 ? "created" : "updated",
  actorType: "user",
  actorId: workspaceId,
  createdAt: "2026-09-01T12:00:00Z",
  snapshotSchemaVersion: 1,
});
function resource(version: number) {
  return {
    id,
    workspaceId,
    displayName: "Original",
    objectType: "task",
    version,
    permissionScopeId: id,
    createdBy: workspaceId,
    createdAt: "2026-09-01T12:00:00Z",
    updatedAt: "2026-09-02T12:00:00Z",
    deletedAt: null,
    archivedAt: null,
    metadata: {},
    customProperties: {},
    status: "todo",
    dueAt: null,
    completedAt: null,
  };
}
let currentVersion: number;
let canRestore: boolean;
let conflict: boolean;
let denied: boolean;
let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
const dialogMethods = ["showModal", "close"] as const;
const dialogDescriptors = dialogMethods.map((name) =>
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name),
);
beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    },
  });
});
afterAll(() => {
  dialogMethods.forEach((name, index) => {
    const descriptor = dialogDescriptors[index];
    if (descriptor === undefined)
      Reflect.deleteProperty(HTMLDialogElement.prototype, name);
    else Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
  });
});

beforeEach(() => {
  currentVersion = 2;
  canRestore = true;
  conflict = false;
  denied = false;
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "test-session", workspaceId }),
  );
  fetch = vi.fn<typeof globalThis.fetch>(async (input, options) => {
    const url = String(input);
    if (denied)
      return Response.json(
        {
          error: {
            code: "resource_unavailable",
            message: "The requested resource is unavailable.",
          },
        },
        { status: 404 },
      );
    if (options?.method === "POST") {
      if (conflict)
        return Response.json(
          {
            error: { code: "version_conflict", message: "The object changed." },
          },
          { status: 409 },
        );
      return Response.json(resource(currentVersion + 1));
    }
    if (url.includes("/restore-preview"))
      return Response.json({
        objectId: id,
        sourceRevisionId: sourceId,
        sourceVersion: 1,
        currentVersion,
        canRestore,
        changes: [change],
        preservedFields: ["Identity and permissions"],
      });
    if (url.includes("/compare?"))
      return Response.json({
        objectId: id,
        fromVersion: 1,
        toVersion: 2,
        changes: [change],
      });
    return Response.json({
      items: [summary(2), summary(1)],
      nextBeforeVersion: null,
    });
  });
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

async function openHistory() {
  const user = userEvent.setup();
  render(
    <Providers>
      <HistoryButton objectId={id} displayName="Plan" />
    </Providers>,
  );
  expect(fetch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "History for Plan" }));
  await screen.findByRole("button", { name: "Preview v1" });
  return user;
}

describe("object history", () => {
  it("loads older summaries using the returned exclusive cursor", async () => {
    fetch.mockImplementation(async (input) =>
      Response.json(
        String(input).includes("beforeVersion=2")
          ? { items: [summary(1)], nextBeforeVersion: null }
          : { items: [summary(3), summary(2)], nextBeforeVersion: 2 },
      ),
    );
    const user = userEvent.setup();
    render(
      <Providers>
        <HistoryButton objectId={id} displayName="Plan" />
      </Providers>,
    );
    await user.click(screen.getByRole("button", { name: "History for Plan" }));
    await user.click(
      await screen.findByRole("button", { name: "Load older versions" }),
    );
    await screen.findByRole("button", { name: "Preview v1" });
    expect(fetch.mock.calls.map(([url]) => String(url))).toContain(
      `/api/objects/${id}/revisions?limit=20&beforeVersion=2`,
    );
    expect(
      screen.queryByRole("button", { name: "Load older versions" }),
    ).not.toBeInTheDocument();
  });
  it("loads only on demand, compares typed fields, and returns focus on close", async () => {
    const user = await openHistory();
    await user.click(screen.getByRole("button", { name: "Compare v1" }));
    await screen.findByText("Original");
    expect(screen.getByRole("combobox", { name: "Before" })).toHaveValue("1");
    expect(screen.getByRole("combobox", { name: "After" })).toHaveValue("2");
    await user.click(screen.getByRole("button", { name: "Close history" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "History for Plan" }),
    ).toHaveFocus();
  });

  it("requires a reviewed preview and fresh confirmation after a version conflict", async () => {
    const user = await openHistory();
    await user.click(screen.getByRole("button", { name: "Preview v1" }));
    const confirm = await screen.findByRole("button", {
      name: "Confirm restore",
    });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /I reviewed/ }));
    conflict = true;
    await user.click(confirm);
    await screen.findByText("A newer version is available");
    expect(
      JSON.parse(
        String(
          fetch.mock.calls.find(
            ([, options]) => options?.method === "POST",
          )?.[1]?.body,
        ),
      ),
    ).toEqual({ expectedVersion: 2 });
    currentVersion = 3;
    conflict = false;
    await user.click(screen.getByRole("button", { name: "Refresh latest" }));
    await screen.findByText("Preview based on current version 3.");
    expect(
      screen.getByRole("checkbox", { name: /I reviewed/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Confirm restore" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /I reviewed/ }));
    await user.click(screen.getByRole("button", { name: "Confirm restore" }));
    await screen.findByText(
      "Restored as version 4. Other views have been refreshed.",
    );
  });

  it("lets Viewers inspect a preview without offering a mutation", async () => {
    canRestore = false;
    const user = await openHistory();
    await user.click(screen.getByRole("button", { name: "Preview v1" }));
    await screen.findByText(/There are no eligible changes/);
    expect(
      screen.queryByRole("button", { name: "Confirm restore" }),
    ).not.toBeInTheDocument();
    expect(
      fetch.mock.calls.some(([, options]) => options?.method === "POST"),
    ).toBe(false);
  });

  it("does not show comparison content when authorization fails", async () => {
    const user = await openHistory();
    denied = true;
    await user.click(screen.getByRole("button", { name: "Compare v1" }));
    await waitFor(
      () => expect(screen.getByRole("alert")).toHaveTextContent("unavailable"),
      { timeout: 3000 },
    );
    expect(screen.queryByText("Original")).not.toBeInTheDocument();
  });
});

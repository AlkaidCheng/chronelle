// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { Providers } from "../app/providers";
import { TrashWorkspace } from "../features/recovery/trash-workspace";

const id = "019d6e7d-0000-7000-8000-000000000001";
const workspaceId = "019d6e7d-0000-7000-8000-000000000002";
const deleted = {
  id,
  objectType: "event",
  displayName: "Workshop",
  version: 2,
  deletedAt: "2026-09-02T20:00:00.000Z",
};
const methods = ["showModal", "close"] as const;
const descriptors = methods.map((name) =>
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name),
);
let currentVersion = 2;
let conflict = false;
let blocked = false;
let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

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
afterAll(() =>
  methods.forEach((name, index) => {
    const descriptor = descriptors[index];
    if (descriptor === undefined)
      Reflect.deleteProperty(HTMLDialogElement.prototype, name);
    else Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
  }),
);
beforeEach(() => {
  currentVersion = 2;
  conflict = false;
  blocked = false;
  window.sessionStorage.setItem(
    "chronelle.development-session",
    JSON.stringify({ accessToken: "test-session", workspaceId }),
  );
  fetch = vi.fn<typeof globalThis.fetch>(async (input, options) => {
    const url = String(input);
    if (url.endsWith("/recovery-preview"))
      return Response.json({
        object: { ...deleted, version: currentVersion },
        canRecover: !blocked,
        blockedReason: blocked
          ? "Restore the canonical permission scope first."
          : null,
      });
    if (url.endsWith("/recover") && options?.method === "POST") {
      if (conflict)
        return Response.json(
          {
            error: { code: "version_conflict", message: "The object changed." },
          },
          { status: 409 },
        );
      return Response.json({
        ...deleted,
        version: currentVersion + 1,
        deletedAt: null,
        workspaceId,
        permissionScopeId: id,
        createdBy: workspaceId,
        createdAt: deleted.deletedAt,
        updatedAt: deleted.deletedAt,
        archivedAt: null,
        customProperties: {},
        metadata: {},
        startsAt: null,
        endsAt: null,
        timezone: "UTC",
        isAllDay: false,
      });
    }
    if (url.endsWith("/shares")) return Response.json({ items: [] });
    return Response.json({ items: [deleted], nextBeforeId: null });
  });
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

async function openPreview() {
  const user = userEvent.setup();
  render(
    <Providers>
      <TrashWorkspace />
    </Providers>,
  );
  await user.click(
    await screen.findByRole("button", {
      name: "Preview recovery for Workshop",
    }),
  );
  const dialog = within(screen.getByRole("dialog"));
  await dialog.findByText("Preview based on deleted version 2.");
  return { user, dialog };
}

it("requires confirmation and submits the displayed object version", async () => {
  const { user, dialog } = await openPreview();
  const confirm = dialog.getByRole("button", { name: "Confirm recovery" });
  expect(confirm).toBeDisabled();
  await user.click(dialog.getByRole("checkbox"));
  await user.click(confirm);
  expect(await dialog.findByRole("status")).toHaveTextContent(
    "Recovered as version 3",
  );
  const request = fetch.mock.calls.find(
    ([url, options]) =>
      String(url).endsWith("/recover") && options?.method === "POST",
  );
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({
    expectedVersion: 2,
  });
});

it("clears confirmation and requires a fresh preview after a conflict", async () => {
  conflict = true;
  const { user, dialog } = await openPreview();
  await user.click(dialog.getByRole("checkbox"));
  await user.click(dialog.getByRole("button", { name: "Confirm recovery" }));
  await dialog.findByRole("alert");
  expect(
    dialog.getByRole("button", { name: "Confirm recovery" }),
  ).toBeDisabled();
  currentVersion = 4;
  await user.click(dialog.getByRole("button", { name: "Refresh latest" }));
  await waitFor(() =>
    expect(
      dialog.getByText("Preview based on deleted version 4."),
    ).toBeVisible(),
  );
  expect(dialog.getByRole("checkbox")).not.toBeChecked();
  expect(
    dialog.getByRole("button", { name: "Confirm recovery" }),
  ).toBeDisabled();
});

it("explains the scope-first recovery requirement without offering a mutation", async () => {
  blocked = true;
  const { dialog } = await openPreview();
  expect(
    dialog.getByText("Restore the canonical permission scope first."),
  ).toBeVisible();
  expect(dialog.queryByRole("button", { name: "Confirm recovery" })).toBeNull();
  expect(
    fetch.mock.calls.every(([, options]) => options?.method !== "POST"),
  ).toBe(true);
});

it("uses typed filters in the Trash request", async () => {
  const user = userEvent.setup();
  render(
    <Providers>
      <TrashWorkspace />
    </Providers>,
  );
  await user.selectOptions(screen.getByLabelText("Object type"), "document");
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(([url]) =>
        String(url).includes("objectType=document"),
      ),
    ).toBe(true),
  );
});

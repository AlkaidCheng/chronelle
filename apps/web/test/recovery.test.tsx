// @vitest-environment jsdom
import {
  act,
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
import { useAuthSession } from "../lib/auth-session";

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
    return Response.json({ items: [deleted], nextCursor: null });
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

function entry(index: number) {
  return {
    ...deleted,
    id: `019d6e7d-0000-7000-8000-${String(index).padStart(12, "0")}`,
    displayName: `Deleted plan ${index}`,
  };
}

it("loads cursor pages once per object and resets inactive filters", async () => {
  fetch.mockImplementation(async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.searchParams.has("objectType"))
      return Response.json({ items: [entry(3)], nextCursor: null });
    return Response.json(
      url.searchParams.has("cursor")
        ? { items: [entry(1), entry(2)], nextCursor: null }
        : { items: [entry(1)], nextCursor: "second_page" },
    );
  });
  const user = userEvent.setup();
  render(
    <Providers>
      <TrashWorkspace />
    </Providers>,
  );
  await screen.findByText("Deleted plan 1");
  await user.click(
    screen.getByRole("button", { name: "Load more deleted objects" }),
  );
  await screen.findByText("Deleted plan 2");
  expect(screen.getAllByText("Deleted plan 1")).toHaveLength(1);
  expect(
    fetch.mock.calls.some(([url]) =>
      String(url).includes("cursor=second_page"),
    ),
  ).toBe(true);
  await user.selectOptions(screen.getByLabelText("Object type"), "event");
  await screen.findByText("Deleted plan 3");
  expect(screen.queryByText("Deleted plan 1")).toBeNull();
  const filtered = fetch.mock.calls.filter(([url]) =>
    String(url).includes("objectType=event"),
  );
  expect(filtered.every(([url]) => !String(url).includes("cursor="))).toBe(
    true,
  );
  await user.selectOptions(screen.getByLabelText("Object type"), "");
  await screen.findByText("Deleted plan 1");
  expect(screen.queryByText("Deleted plan 2")).toBeNull();
});

it.each(["filter", "workspace"])(
  "cancels a pending page when the %s changes and ignores its late result",
  async (change) => {
    let resolvePage: ((response: Response) => void) | undefined;
    let signal: AbortSignal | null | undefined;
    fetch.mockImplementation(async (input, options) => {
      const url = new URL(String(input), "http://localhost");
      if (url.searchParams.has("cursor")) {
        signal = options?.signal;
        return new Promise<Response>((resolve) => {
          resolvePage = resolve;
        });
      }
      const switched =
        new Headers(options?.headers).get("x-workspace-id") !== workspaceId;
      return Response.json(
        switched || url.searchParams.has("objectType")
          ? { items: [entry(3)], nextCursor: null }
          : { items: [entry(1)], nextCursor: "second_page" },
      );
    });
    function SwitchWorkspace() {
      const { switchWorkspace } = useAuthSession();
      return (
        <button
          type="button"
          onClick={() =>
            switchWorkspace("019d6e7d-0000-7000-8000-000000000004")
          }
        >
          Switch workspace
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <Providers>
        <SwitchWorkspace />
        <TrashWorkspace />
      </Providers>,
    );
    await screen.findByText("Deleted plan 1");
    await user.click(
      screen.getByRole("button", { name: "Load more deleted objects" }),
    );
    await waitFor(() => expect(resolvePage).toBeDefined());
    if (change === "filter")
      await user.selectOptions(screen.getByLabelText("Object type"), "event");
    else
      await user.click(
        screen.getByRole("button", { name: "Switch workspace" }),
      );
    await screen.findByText("Deleted plan 3");
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      resolvePage?.(Response.json({ items: [entry(2)], nextCursor: null }));
    });
    expect(screen.queryByText("Deleted plan 2")).toBeNull();
    expect(screen.queryByText("Deleted plan 1")).toBeNull();
  },
);

it("retains loaded Trash on a continuation error and refreshes current access", async () => {
  fetch.mockImplementation(async (input) =>
    String(input).includes("cursor=")
      ? Response.json(
          { error: { code: "unavailable", message: "Try again." } },
          { status: 503 },
        )
      : Response.json({ items: [entry(1)], nextCursor: "second_page" }),
  );
  const user = userEvent.setup();
  render(
    <Providers>
      <TrashWorkspace />
    </Providers>,
  );
  await screen.findByText("Deleted plan 1");
  await user.click(
    screen.getByRole("button", { name: "Load more deleted objects" }),
  );
  await screen.findByRole("alert", {}, { timeout: 3000 });
  expect(screen.getByText("Deleted plan 1")).toBeVisible();
  fetch.mockImplementation(async () =>
    Response.json({ items: [], nextCursor: null }),
  );
  await user.click(screen.getByRole("button", { name: "Refresh Trash" }));
  await screen.findByText("No recoverable objects");
  expect(screen.queryByText("Deleted plan 1")).toBeNull();
});

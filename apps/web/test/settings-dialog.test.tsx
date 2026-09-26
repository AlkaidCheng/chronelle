// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SettingsRoute from "../app/(workspace)/settings/page";
import AppearanceSettingsRoute from "../app/(workspace)/settings/appearance/page";
import KeyboardSettingsRoute from "../app/(workspace)/settings/keyboard/page";
import LanguageTimeSettingsRoute from "../app/(workspace)/settings/language/page";
import MembersSettingsRoute from "../app/(workspace)/settings/members/page";
import { Providers } from "../app/providers";
import { SettingsLink } from "../components/settings-link";
import { WorkspaceShell } from "../components/workspace-shell";
import { SettingsLayer } from "../features/settings/settings-dialog";
import { activeTimePreferences } from "../i18n/active-preferences";
import { localeCookie } from "../i18n/locales";
import { useAdoptAccountLocale } from "../lib/queries";
import type { SettingsSection } from "../lib/settings-address";
import {
  DisplayPreferencesProvider,
  useDisplayPreferences,
} from "../lib/use-display-preferences";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
const redirect = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
);
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/events",
  redirect,
}));

let store: SandboxStore;
let saved: string | null;
const requests: { method: string; path: string; body: unknown }[] = [];

beforeEach(() => {
  saved = null;
  store = new SandboxStore({
    getItem: () => saved,
    setItem: (_key, value) => {
      saved = value;
    },
  });
  requests.length = 0;
  vi.stubGlobal("localStorage", window.sessionStorage);
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "sample", workspaceId: sandboxWorkspaceId }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>((input, options) => {
      requests.push({
        method: options?.method ?? "GET",
        path: new URL(String(input), "https://sandbox.invalid").pathname,
        body: options?.body ? JSON.parse(String(options.body)) : undefined,
      });
      return store.fetch(input, options);
    }),
  );
  for (const method of ["showModal", "close"] as const) {
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.toggleAttribute("open", method === "showModal");
      },
    });
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  router.refresh.mockClear();
  router.replace.mockClear();
  window.history.replaceState(null, "", "/events");
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is async and absent from jsdom
  document.cookie = `${localeCookie}=; Path=/; Max-Age=0`;
});

const wrapper = ({ children }: { readonly children: ReactNode }) => (
  <Providers>{children}</Providers>
);

/** Settings inside the rail, whose provider publishes the account's preferences. */
const inShell = ({ children }: { readonly children: ReactNode }) => (
  <Providers>
    <WorkspaceShell>{children}</WorkspaceShell>
  </Providers>
);

/** Settings over an event's To-dos, opened at `section` by the address. */
function renderAt(section: SettingsSection, shell: typeof wrapper = wrapper) {
  window.history.replaceState(
    null,
    "",
    `/events/plan?view=todos&settings=${section}`,
  );
  return render(<SettingsLayer />, { wrapper: shell });
}

/** The sample account's preferences as the store holds them. */
async function storedPreferences() {
  const response = await store.fetch(
    "https://sandbox.invalid/api/auth/session",
  );
  const session = (await response.json()) as {
    user: {
      locale: string | null;
      timeZone: string | null;
      hourCycle: string | null;
      weekStart: number | null;
    };
  };
  return session.user;
}

describe("the Settings dialog", () => {
  it("opens over the page at the section its address names, the sections listed with the current one marked", async () => {
    renderAt("general");
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    const nav = within(within(dialog).getByRole("navigation"));
    expect(nav.getByRole("button", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(nav.getByRole("button", { name: "General" })).toHaveFocus();
    expect(
      nav.getByRole("button", { name: "Language & time" }),
    ).not.toHaveAttribute("aria-current");
    expect(
      nav.getAllByRole("button").map((entry) => entry.textContent),
    ).toEqual(["General", "Language & time", "Appearance", "Members"]);
    expect(nav.getByRole("list", { name: "Preferences" })).toBeVisible();
    expect(nav.getByRole("list", { name: "Space" })).toBeVisible();
    expect(
      within(dialog).getByRole("region", { name: "General" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("heading", { level: 2, name: "General" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
        "Sample planner",
      ),
    );
    expect(screen.getByText("planner@example.test")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Change password" }),
    ).toHaveAttribute("href", "/reset-password");
  });

  it("changes section in place and, closed, takes itself out of an address it did not add", async () => {
    const user = userEvent.setup();
    renderAt("general");
    const entries = window.history.length;
    await user.click(screen.getByRole("button", { name: "Language & time" }));
    expect(window.location.search).toBe("?view=todos&settings=language");
    expect(window.history.length).toBe(entries);
    expect(
      screen.getByRole("heading", { level: 2, name: "Language & time" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Close settings" }));
    expect(window.location.pathname).toBe("/events/plan");
    expect(window.location.search).toBe("?view=todos");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.history.length).toBe(entries);
  });

  it("opens from a link as a history entry of its own, which closing steps back from", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/events/plan?view=todos");
    render(
      <>
        <SettingsLink section="keyboard" onOpen={() => undefined}>
          Keyboard shortcuts
        </SettingsLink>
        <SettingsLayer />
      </>,
      { wrapper },
    );
    const link = screen.getByRole("link", { name: "Keyboard shortcuts" });
    expect(link).toHaveAttribute(
      "href",
      "/events/plan?view=todos&settings=keyboard",
    );
    const entries = window.history.length;
    await user.click(link);
    expect(window.location.search).toBe("?view=todos&settings=keyboard");
    expect(window.history.length).toBe(entries + 1);
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    // Without a keyboard the section is listed only while it is open, and
    // says it needs one.
    expect(
      within(dialog).getByRole("button", { name: "Keyboard" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByText("This section appears on devices with a keyboard."),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "General" }));
    expect(
      within(dialog).queryByRole("button", { name: "Keyboard" }),
    ).toBeNull();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(window.location.search).toBe("?view=todos");
  });

  it("leaves a modified click on its link to the browser", () => {
    window.history.replaceState(null, "", "/tasks");
    render(
      <SettingsLink section="members" onOpen={() => undefined}>
        Members
      </SettingsLink>,
    );
    const link = screen.getByRole("link", { name: "Members" });
    expect(link).toHaveAttribute("href", "/tasks?settings=members");
    // The browser's own action (a new tab) is stood in for; jsdom has none.
    const browser = vi.fn((event: Event) => event.preventDefault());
    document.addEventListener("click", browser, { once: true });
    fireEvent.click(link, { metaKey: true });
    expect(browser).toHaveBeenCalledOnce();
    expect(window.location.search).toBe("");
  });

  it("changes the name through PATCH /api/account and keeps it on the session", async () => {
    const user = userEvent.setup();
    renderAt("general");
    const name = await screen.findByRole("textbox", { name: "Name" });
    await waitFor(() => expect(name).toHaveValue("Sample planner"));
    const save = screen.getByRole("button", { name: "Save name" });
    expect(save).toBeDisabled();
    await user.clear(name);
    await user.type(name, "  Mira Planner ");
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(requests).toContainEqual({
      method: "PATCH",
      path: "/api/account",
      body: { displayName: "Mira Planner" },
    });
    expect(name).toHaveValue("Mira Planner");
  });

  it("shows the username as chosen at sign-up and keeps who can find the account", async () => {
    const user = userEvent.setup();
    renderAt("general");
    await screen.findByText("@planner");
    expect(screen.getByText(/cannot be changed\./)).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "Username" }),
    ).not.toBeInTheDocument();
    const byUsername = screen.getByRole("switch", { name: "By username" });
    expect(byUsername).toBeChecked();
    expect(byUsername).toBeDisabled();
    const byEmail = screen.getByRole("switch", { name: "By email" });
    expect(byEmail).toBeChecked();
    await user.click(byEmail);
    await waitFor(() => expect(byEmail).not.toBeChecked());
    expect(requests).toContainEqual({
      method: "PATCH",
      path: "/api/account",
      body: { findByEmail: false },
    });
    expect(screen.getByRole("switch", { name: "By name" })).toBeChecked();
    expect(screen.getByText(/@planner is how friends find you/)).toBeVisible();
  });

  it("signs out everywhere through DELETE /api/auth/sessions and leaves for sign-in", async () => {
    const user = userEvent.setup();
    renderAt("general");
    await user.click(
      await screen.findByRole("button", { name: "Sign out everywhere" }),
    );
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/sign-in"),
    );
    expect(requests).toContainEqual({
      method: "DELETE",
      path: "/api/auth/sessions",
      body: undefined,
    });
    expect(window.sessionStorage.getItem("chronelle.session")).toBeNull();
  });

  it("keeps the clock, week start, and zone on the account and applies them at once", async () => {
    const user = userEvent.setup();
    renderAt("language", inShell);
    expect(
      await screen.findByRole("button", { name: "Language & time" }),
    ).toHaveAttribute("aria-current", "page");
    const clock = within(screen.getByRole("group", { name: "Time format" }));
    await waitFor(() =>
      expect(clock.getByRole("radio", { name: "From language" })).toBeChecked(),
    );
    await user.click(clock.getByRole("radio", { name: "24-hour" }));
    await waitFor(() =>
      expect(requests).toContainEqual({
        method: "PATCH",
        path: "/api/auth/me",
        body: { hourCycle: "h23" },
      }),
    );
    await waitFor(async () =>
      expect((await storedPreferences()).hourCycle).toBe("h23"),
    );
    expect(activeTimePreferences().hourCycle).toBe("h23");
    expect(screen.getByText(/^Now: /)).toHaveTextContent(
      /Now: \w{3} \d{1,2}, \d{4}, \d{2}:\d{2}$/,
    );

    const week = within(screen.getByRole("group", { name: "Week starts on" }));
    await user.click(week.getByRole("radio", { name: "Monday" }));
    await waitFor(async () =>
      expect((await storedPreferences()).weekStart).toBe(1),
    );
    expect(activeTimePreferences().weekStart).toBe(1);

    const zone = screen.getByRole("combobox", { name: "Time zone" });
    expect(zone).toHaveValue("");
    expect(
      within(zone).getByRole("option", { name: /^Device: / }),
    ).toBeVisible();
    await user.type(
      screen.getByRole("searchbox", { name: "Search time zones" }),
      "tokyo",
    );
    expect(
      within(zone).getByRole("option", { name: /^Tokyo \(UTC\+09:00\)$/ }),
    ).toBeVisible();
    expect(
      within(zone).queryByRole("option", { name: /^Shanghai/ }),
    ).toBeNull();
    await user.selectOptions(zone, "Asia/Tokyo");
    await waitFor(async () =>
      expect((await storedPreferences()).timeZone).toBe("Asia/Tokyo"),
    );
    expect(activeTimePreferences().timeZone).toBe("Asia/Tokyo");
    expect(zone).toHaveValue("Asia/Tokyo");
    await user.selectOptions(zone, "");
    await waitFor(async () =>
      expect((await storedPreferences()).timeZone).toBeNull(),
    );
  });

  it("keeps a language choice on the account and in the cookie", async () => {
    const user = userEvent.setup();
    renderAt("language");
    const language = within(
      await screen.findByRole("group", { name: "Language" }),
    );
    await user.click(
      language.getByRole("radio", { name: "\u7e41\u9ad4\u4e2d\u6587" }),
    );
    expect(document.cookie).toContain(`${localeCookie}=zh-Hant`);
    expect(router.refresh).toHaveBeenCalled();
    await waitFor(async () =>
      expect((await storedPreferences()).locale).toBe("zh-Hant"),
    );
    await user.click(language.getByRole("radio", { name: "System" }));
    await waitFor(async () =>
      expect((await storedPreferences()).locale).toBeNull(),
    );
    expect(document.cookie).not.toContain(`${localeCookie}=zh`);
  });

  it("repeats the Theme choices under Appearance", () => {
    renderAt("appearance");
    expect(screen.getByRole("button", { name: "Appearance" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("group", { name: "Palette" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Density" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Motion" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Reset display settings" }),
    ).toBeVisible();
    expect(screen.queryByRole("group", { name: "Language" })).toBeNull();
  });

  it("offers Keyboard on a keyboard device, with the shortcut table", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(hover: hover) and (pointer: fine)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    renderAt("general");
    expect(
      screen
        .getAllByRole("button")
        .filter((entry) => entry.closest("nav") !== null)
        .map((entry) => entry.textContent),
    ).toEqual([
      "General",
      "Language & time",
      "Appearance",
      "Keyboard",
      "Members",
    ]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Keyboard" }));
    expect(window.location.search).toBe("?view=todos&settings=keyboard");
    const table = within(screen.getByRole("table"));
    expect(table.getAllByRole("row")).toHaveLength(6);
    const search = table.getByRole("switch", { name: "Open Search" });
    expect(search).toBeChecked();
    await user.click(search);
    expect(search).not.toBeChecked();
    expect(window.localStorage.getItem("chronelle.command-shortcut")).toBe(
      "disabled",
    );
    await user.selectOptions(
      table.getByRole("combobox", { name: "Add a component" }),
      "disabled",
    );
    expect(window.localStorage.getItem("chronelle.component-shortcut")).toBe(
      "disabled",
    );
    expect(table.getAllByText("Always on")).toHaveLength(2);
    await user.click(
      screen.getByRole("button", { name: "Reset keyboard shortcuts" }),
    );
    expect(search).toBeChecked();
    expect(
      window.localStorage.getItem("chronelle.command-shortcut"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("chronelle.component-shortcut"),
    ).toBeNull();
  });

  it("ignores an address naming no section", () => {
    window.history.replaceState(null, "", "/events?settings=account");
    render(<SettingsLayer />, { wrapper });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("the old Settings addresses", () => {
  it.each([
    [SettingsRoute, "general"],
    [LanguageTimeSettingsRoute, "language"],
    [AppearanceSettingsRoute, "appearance"],
    [KeyboardSettingsRoute, "keyboard"],
    [MembersSettingsRoute, "members"],
  ])("open Settings over Events", (route, section) => {
    expect(() => route()).toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith(`/events?settings=${section}`);
  });
});

describe("useDisplayPreferences", () => {
  it("follows the device and the language without a provider", () => {
    const { result } = renderHook(() => useDisplayPreferences());
    expect(result.current).toEqual({
      locale: "en",
      timeZone: null,
      hourCycle: null,
      weekStart: null,
      instant: {},
      firstDay: 7,
    });
  });

  it("resolves the account's choices inside the provider", () => {
    const { result } = renderHook(() => useDisplayPreferences(), {
      wrapper: ({ children }) => (
        <DisplayPreferencesProvider
          preferences={{
            timeZone: "Asia/Taipei",
            hourCycle: "h12",
            weekStart: 1,
          }}
        >
          {children}
        </DisplayPreferencesProvider>
      ),
    });
    expect(result.current).toMatchObject({
      timeZone: "Asia/Taipei",
      hourCycle: "h12",
      weekStart: 1,
      instant: { timeZone: "Asia/Taipei", hourCycle: "h12" },
      firstDay: 1,
    });
    expect(activeTimePreferences()).toEqual({
      timeZone: "Asia/Taipei",
      hourCycle: "h12",
      weekStart: 1,
    });
  });
});

describe("the account's language at sign-in", () => {
  it("puts the account's language on the browser, and teaches an account without one the browser's choice", async () => {
    const { result } = renderHook(() => useAdoptAccountLocale(), { wrapper });
    result.current({ locale: "zh-Hant" });
    expect(document.cookie).toContain(`${localeCookie}=zh-Hant`);
    expect(window.localStorage.getItem(localeCookie)).toBe("zh-Hant");
    expect(router.refresh).toHaveBeenCalledOnce();
    // The same language again changes nothing.
    result.current({ locale: "zh-Hant" });
    expect(router.refresh).toHaveBeenCalledOnce();
    // An account with no language learns the browser's choice.
    result.current({ locale: null });
    await waitFor(async () =>
      expect((await storedPreferences()).locale).toBe("zh-Hant"),
    );
    expect(requests).toContainEqual({
      method: "PATCH",
      path: "/api/auth/me",
      body: { locale: "zh-Hant" },
    });
    // A language this build does not speak leaves the browser's alone.
    result.current({ locale: "ja" });
    expect(document.cookie).toContain(`${localeCookie}=zh-Hant`);
    expect(router.refresh).toHaveBeenCalledOnce();
  });
});

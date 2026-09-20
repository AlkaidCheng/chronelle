// @vitest-environment jsdom

import {
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { WorkspaceShell } from "../components/workspace-shell";
import { SettingsPage } from "../features/settings/settings-page";
import { activeTimePreferences } from "../i18n/active-preferences";
import { localeCookie } from "../i18n/locales";
import { useAdoptAccountLocale } from "../lib/queries";
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
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/settings",
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  router.refresh.mockClear();
  router.replace.mockClear();
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is async and absent from jsdom
  document.cookie = `${localeCookie}=; Path=/; Max-Age=0`;
});

const wrapper = ({ children }: { readonly children: ReactNode }) => (
  <Providers>{children}</Providers>
);

/** The page inside the rail, whose provider publishes the account's preferences. */
const inShell = ({ children }: { readonly children: ReactNode }) => (
  <Providers>
    <WorkspaceShell>{children}</WorkspaceShell>
  </Providers>
);

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

describe("the Settings page", () => {
  it("lists its sections with the open one marked and shows the account", async () => {
    render(<SettingsPage section="account" />, { wrapper });
    const nav = within(
      screen.getByRole("navigation", { name: "Settings sections" }),
    );
    expect(nav.getByRole("link", { name: "Account" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(nav.getByRole("link", { name: "Language & time" })).toHaveAttribute(
      "href",
      "/settings/language",
    );
    expect(
      nav.getByRole("link", { name: "Language & time" }),
    ).not.toHaveAttribute("aria-current");
    expect(nav.getByRole("link", { name: "Appearance" })).toHaveAttribute(
      "href",
      "/settings/appearance",
    );
    expect(nav.getByText("Preferences")).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 2, name: "Account" }),
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

  it("changes the name through PATCH /api/account and keeps it on the session", async () => {
    const user = userEvent.setup();
    render(<SettingsPage section="account" />, { wrapper });
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
    render(<SettingsPage section="account" />, { wrapper });
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
    render(<SettingsPage section="account" />, { wrapper });
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
    render(<SettingsPage section="language" />, { wrapper: inShell });
    expect(
      await screen.findByRole("link", { name: "Language & time" }),
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
    render(<SettingsPage section="language" />, { wrapper });
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

  it("repeats the Theme choices under Appearance", async () => {
    render(<SettingsPage section="appearance" />, { wrapper });
    expect(screen.getByRole("link", { name: "Appearance" })).toHaveAttribute(
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

  it("offers Keyboard on a keyboard device alone, with the shortcut table", async () => {
    // Without a keyboard (no hover, no fine pointer) the section is absent
    // from the navigation and a direct visit says so.
    render(<SettingsPage section="keyboard" />, { wrapper });
    expect(screen.queryByRole("link", { name: "Keyboard" })).toBeNull();
    expect(
      screen.getByText("This page appears on devices with a keyboard."),
    ).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
    cleanup();
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(hover: hover) and (pointer: fine)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    render(<SettingsPage section="keyboard" />, { wrapper });
    expect(screen.getByRole("link", { name: "Keyboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const table = within(screen.getByRole("table"));
    expect(table.getAllByRole("row")).toHaveLength(6);
    const search = table.getByRole("switch", { name: "Open Search" });
    expect(search).toBeChecked();
    const user = userEvent.setup();
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

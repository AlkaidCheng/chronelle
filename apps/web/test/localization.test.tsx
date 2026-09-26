// @vitest-environment jsdom

import type { TaskResponse } from "@livtales/schemas";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Providers } from "../app/providers";
import { LocaleControl } from "../components/locale-control";
import { WorkspaceShell } from "../components/workspace-shell";
import { EventList } from "../features/events/event-list";
import { TasksPanel } from "../features/events/planning-panels";
import { useLocaleChoice } from "../i18n/locale-preference";
import { LocaleSync } from "../i18n/locale-sync";
import { loadMessages } from "../i18n/messages";
import { type Locale, localeCookie } from "../i18n/locales";
import { formatDateTime } from "../lib/format";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/events",
}));

let store: SandboxStore;

beforeEach(() => {
  store = new SandboxStore({ getItem: () => null, setItem: () => undefined });
  vi.stubGlobal("localStorage", window.sessionStorage);
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "sample", workspaceId: sandboxWorkspaceId }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>((input, options) =>
      store.fetch(input, options),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is async and absent from jsdom
  document.cookie = `${localeCookie}=; Path=/; Max-Age=0`;
  document.documentElement.lang = "";
});

/** Renders children the way the layout does for one locale. */
async function renderIn(locale: Locale, children: ReactNode) {
  const messages = await loadMessages(locale);
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <LocaleSync />
      <Providers>{children}</Providers>
    </NextIntlClientProvider>,
  );
}

/**
 * The control inside a provider that follows the control's own choice, the
 * way the server re-renders after a refresh.
 */
function ChoiceHarness({
  catalogs,
}: {
  readonly catalogs: Record<Locale, Awaited<ReturnType<typeof loadMessages>>>;
}) {
  const { choice } = useLocaleChoice();
  const locale = choice === "system" ? "en" : choice;
  return (
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]}>
      <LocaleSync />
      <LocaleControl />
    </NextIntlClientProvider>
  );
}

it("stores the chosen language in the cookie and puts it on the document", async () => {
  const user = userEvent.setup();
  const catalogs = {
    en: await loadMessages("en"),
    "zh-Hans": await loadMessages("zh-Hans"),
    "zh-Hant": await loadMessages("zh-Hant"),
  };
  render(<ChoiceHarness catalogs={catalogs} />);
  const language = screen.getByRole("combobox");
  expect(language).toHaveValue("system");
  expect(
    within(language).getByRole("option", { name: "System" }),
  ).toBeInTheDocument();
  await user.selectOptions(language, "\u7b80\u4f53\u4e2d\u6587");
  expect(document.cookie).toContain(`${localeCookie}=zh-Hans`);
  expect(window.localStorage.getItem(localeCookie)).toBe("zh-Hans");
  expect(router.refresh).toHaveBeenCalled();
  expect(document.documentElement.lang).toBe("zh-Hans");
  expect(language).toHaveValue("zh-Hans");
  expect(formatDateTime(null)).toBe("\u672a\u5b89\u6392");
  await user.selectOptions(language, "\u8ddf\u968f\u7cfb\u7edf");
  expect(document.cookie).not.toContain(`${localeCookie}=zh`);
  expect(window.localStorage.getItem(localeCookie)).toBeNull();
  expect(document.documentElement.lang).toBe("en");
  expect(formatDateTime(null)).toBe("Not scheduled");
});

it("words the rail and the Events page in Simplified Chinese", async () => {
  await renderIn(
    "zh-Hans",
    <WorkspaceShell>
      <EventList />
    </WorkspaceShell>,
  );
  const rail = await screen.findByRole("navigation", {
    name: "\u7a7a\u95f4\u5bfc\u822a",
  });
  expect(rail).toHaveTextContent("\u4f19\u4f34");
  expect(rail).toHaveTextContent("\u96c6\u5408");
  // Trash sits under More, which is wordy in its own language too.
  await userEvent.click(screen.getByRole("button", { name: "\u66f4\u591a" }));
  expect(
    screen.getByRole("menuitem", { name: "\u56de\u6536\u7ad9" }),
  ).toHaveAttribute("href", "/trash");
  await userEvent.keyboard("{Escape}");
  expect(
    screen.getByRole("heading", { level: 1, name: "\u6d3b\u52a8" }),
  ).toBeVisible();
  expect(
    await screen.findByText(/\u5df2\u52a0\u8f7d \d+ \u4e2a\u6d3b\u52a8/),
  ).toBeVisible();
});

it("counts the To-dos in Simplified Chinese", async () => {
  const response = await store.fetch("/api/tasks?filter=open");
  const { items, contexts } = (await response.json()) as {
    items: readonly TaskResponse[];
    contexts: Record<string, { eventId: string } | undefined>;
  };
  const eventId = Object.values(contexts)[0]?.eventId;
  if (eventId === undefined) throw new Error("the sandbox has no event tasks");
  const tasks = items.filter((task) => contexts[task.id]?.eventId === eventId);
  await renderIn(
    "zh-Hans",
    <TasksPanel canEdit eventId={eventId} tasks={tasks} />,
  );
  expect(screen.getByRole("heading", { name: "\u5f85\u529e" })).toBeVisible();
  expect(
    screen.getByText(`${tasks.length} \u9879\u672a\u5b8c\u6210`),
  ).toBeVisible();
});

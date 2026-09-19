// @vitest-environment jsdom

import { act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { DevelopmentSignInForm } from "../app/sign-in/development/development-sign-in-form";
import SignInPage from "../app/sign-in/page";
import { AuthSessionProvider } from "../lib/auth-session";
import { withIntl } from "./intl";

const developmentSignIn = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));
const passwordSignIn = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
}));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../lib/queries", () => ({
  useDevelopmentSignIn: () => developmentSignIn,
}));
vi.mock("../lib/account-queries", () => ({
  usePasswordSignIn: () => passwordSignIn,
  useRedirectWhenSignedIn: () => undefined,
}));

// Server markup and hydration share one element, rendered inside the
// messages provider the way the layout renders every page.
const Localized = withIntl();

async function renderHydrated(inner: React.ReactElement) {
  const element = <Localized>{inner}</Localized>;
  const container = document.createElement("div");
  container.innerHTML = renderToString(element);
  document.body.append(container);
  return {
    container,
    view: within(container),
    hydrate: async () => {
      let root: Root | undefined;
      await act(async () => {
        root = hydrateRoot(container, element);
      });
      return root;
    },
  };
}

it("enables the password sign-in only after hydration and submits the credentials", async () => {
  sessionStorage.clear();
  const element = (
    <AuthSessionProvider>
      <SignInPage />
    </AuthSessionProvider>
  );
  const { container, view, hydrate } = await renderHydrated(element);
  let root: Root | undefined;
  try {
    expect(view.getByLabelText("Username or email address")).toBeDisabled();
    expect(view.getByLabelText("Password")).toBeDisabled();
    expect(view.getByRole("button", { name: "Sign in" })).toBeDisabled();
    root = await hydrate();
    // The tab has no stored workspace, so the cookie session is looked up
    // before the form enables; the lookup fails here and the form opens.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(view.getByLabelText("Username or email address")).toBeEnabled();
    expect(
      view.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/sign-up");
    expect(
      view.getByRole("link", { name: "Forgot password?" }),
    ).toHaveAttribute("href", "/reset-password");
    // The language and theme menus sit in the footer under the card.
    const theme = view.getByRole("combobox", { name: "Theme" });
    expect(theme).toHaveValue("system");
    const language = view.getByRole("combobox", { name: "Language" });
    expect(language).toHaveValue("system");
    expect(
      within(language)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "System",
      "English",
      "\u7b80\u4f53\u4e2d\u6587",
      "\u7e41\u9ad4\u4e2d\u6587",
    ]);
    const user = userEvent.setup();
    await user.type(
      view.getByLabelText("Username or email address"),
      "planner",
    );
    await user.type(view.getByLabelText("Password"), "correct horse battery");
    await user.click(view.getByRole("button", { name: "Sign in" }));
    expect(passwordSignIn.mutate).toHaveBeenCalledOnce();
    expect(passwordSignIn.mutate.mock.calls[0]?.[0]).toEqual({
      login: "planner",
      password: "correct horse battery",
    });
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    sessionStorage.clear();
  }
});

it("keeps the development form with its name and email fields", async () => {
  sessionStorage.clear();
  const element = (
    <AuthSessionProvider>
      <DevelopmentSignInForm />
    </AuthSessionProvider>
  );
  const { container, view, hydrate } = await renderHydrated(element);
  let root: Root | undefined;
  try {
    expect(view.getByLabelText("Name")).toBeDisabled();
    root = await hydrate();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const user = userEvent.setup();
    await user.type(view.getByLabelText("Name"), "Planner");
    await user.type(view.getByLabelText("Email"), "planner@example.test");
    await user.click(view.getByRole("button", { name: "Continue" }));
    expect(developmentSignIn.mutate).toHaveBeenCalledExactlyOnceWith({
      displayName: "Planner",
      email: "planner@example.test",
    });
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    sessionStorage.clear();
  }
});

// @vitest-environment jsdom

import { act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";

import SignInPage from "../app/sign-in/page";
import { AuthSessionProvider } from "../lib/auth-session";

const signIn = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../lib/queries", () => ({ useDevelopmentSignIn: () => signIn }));

it("enables sign-in fields only after hydration and preserves entered values", async () => {
  sessionStorage.clear();
  const element = (
    <AuthSessionProvider>
      <SignInPage />
    </AuthSessionProvider>
  );
  const container = document.createElement("div");
  container.innerHTML = renderToString(element);
  document.body.append(container);
  const view = within(container);
  let root: Root | undefined;
  try {
    expect(view.getByLabelText("Name")).toBeDisabled();
    expect(view.getByLabelText("Email")).toBeDisabled();
    expect(view.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(
      view.getByRole("button", { name: "Customize appearance" }),
    ).toBeDisabled();

    await act(async () => {
      root = hydrateRoot(container, element);
    });
    expect(view.getByLabelText("Name")).toBeEnabled();
    expect(view.getByLabelText("Email")).toBeEnabled();
    expect(
      view.getByRole("button", { name: "Customize appearance" }),
    ).toBeEnabled();
    const user = userEvent.setup();
    await user.type(view.getByLabelText("Name"), "Planner");
    await user.type(view.getByLabelText("Email"), "planner@example.test");
    await user.click(view.getByRole("button", { name: "Continue" }));
    expect(signIn.mutate).toHaveBeenCalledExactlyOnceWith({
      displayName: "Planner",
      email: "planner@example.test",
    });
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    sessionStorage.clear();
  }
});

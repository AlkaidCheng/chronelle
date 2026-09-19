// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import ResetPasswordPage from "../app/reset-password/page";
import SignUpPage from "../app/sign-up/page";
import VerifyEmailPage from "../app/verify-email/page";
import { AuthSessionProvider } from "../lib/auth-session";

type Mutation = {
  mutate: ReturnType<typeof vi.fn>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
};
const mutation = (): Mutation => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  isSuccess: false,
});
const mutations = vi.hoisted(() => ({
  signUp: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
  },
  verify: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
  },
  resend: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
  },
  request: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
  },
  confirm: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
  },
}));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const searchParams = vi.hoisted(
  () => new URLSearchParams("email=p%40example.test"),
);
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => searchParams,
}));
const availability = vi.hoisted(() => ({
  data: undefined as { available: boolean } | undefined,
}));
vi.mock("../lib/friend-queries", () => ({
  useUsernameAvailableQuery: (username: string, enabled: boolean) => ({
    data:
      enabled && username !== ""
        ? { available: username.toLowerCase() !== "taken_one" }
        : availability.data,
  }),
}));
vi.mock("../lib/account-queries", () => ({
  useRedirectWhenSignedIn: () => undefined,
  useSignUp: () => mutations.signUp,
  useVerifyEmail: () => mutations.verify,
  useResendVerification: () => mutations.resend,
  useRequestPasswordReset: () => mutations.request,
  useConfirmPasswordReset: () => mutations.confirm,
}));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  for (const entry of Object.values(mutations))
    Object.assign(entry, mutation());
});

/** Renders inside the session provider and lets the cookie lookup settle. */
async function renderScreen(screenElement: () => React.ReactElement) {
  const { rerender } = render(
    <AuthSessionProvider>{screenElement()}</AuthSessionProvider>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    user: userEvent.setup(),
    // A fresh element, so the screen re-reads its mutation state.
    rerender: () =>
      rerender(<AuthSessionProvider>{screenElement()}</AuthSessionProvider>),
  };
}

it("sign-up asks for the email, the password, and a username it checks as typed, then moves to the code screen", async () => {
  mutations.signUp.mutate.mockImplementation(
    (_input: unknown, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
  );
  const { user } = await renderScreen(() => <SignUpPage />);
  // No name here: the Welcome step asks for it after the code.
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  const username = screen.getByRole("textbox", { name: "Username" });
  await user.type(username, "taken_one");
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "taken_one is not available.",
    ),
  );
  await user.clear(username);
  await user.type(username, "1bad");
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "This username is not valid.",
    ),
  );
  await user.clear(username);
  await user.type(username, "mira_p");
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "mira_p is available.",
    ),
  );
  expect(
    screen.getByText(/Usernames may contain letters, digits, hyphens/),
  ).toBeVisible();
  await user.type(screen.getByLabelText("Email"), "p@example.test");
  await user.type(screen.getByLabelText("Password"), "correct horse battery");
  expect(
    screen.getByText("Passwords must be at least 10 characters long."),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(mutations.signUp.mutate.mock.calls[0]?.[0]).toEqual({
    email: "p@example.test",
    password: "correct horse battery",
    username: "mira_p",
  });
  expect(router.push).toHaveBeenCalledWith(
    "/verify-email?email=p%40example.test",
  );
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/sign-in",
  );
});

it("verify-email names the address from the link, submits the code, and can request another", async () => {
  const { user } = await renderScreen(() => <VerifyEmailPage />);
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  expect(
    screen.getByText(/Enter the six-digit code sent to p@example\.test\./),
  ).toBeVisible();
  await user.type(screen.getByLabelText("Verification code"), "123456");
  await user.click(screen.getByRole("button", { name: "Confirm" }));
  expect(mutations.verify.mutate.mock.calls[0]?.[0]).toEqual({
    email: "p@example.test",
    code: "123456",
  });
  await user.click(screen.getByRole("button", { name: "Send a new code" }));
  expect(mutations.resend.mutate.mock.calls[0]?.[0]).toEqual({
    email: "p@example.test",
  });
});

it("reset-password asks for the email first, then the code and new password", async () => {
  // An accepted request flips the mutation to success, as the real one does.
  mutations.request.mutate.mockImplementation(() => {
    mutations.request.isSuccess = true;
  });
  const { user, rerender } = await renderScreen(() => <ResetPasswordPage />);
  expect(screen.queryByLabelText("Reset code")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Email"), "p@example.test");
  await user.click(screen.getByRole("button", { name: "Send reset code" }));
  expect(mutations.request.mutate.mock.calls[0]?.[0]).toEqual({
    email: "p@example.test",
  });
  rerender();
  // The code step names the address instead of asking for it again.
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  expect(screen.getByText(/code sent to p@example\.test/)).toBeVisible();
  await user.type(screen.getByLabelText("Reset code"), "654321");
  await user.type(
    screen.getByLabelText("New password"),
    "a brand new passphrase",
  );
  await user.click(screen.getByRole("button", { name: "Set new password" }));
  expect(mutations.confirm.mutate.mock.calls[0]?.[0]).toEqual({
    email: "p@example.test",
    code: "654321",
    password: "a brand new passphrase",
  });
});

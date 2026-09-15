// @vitest-environment jsdom

import { act, render, screen, cleanup } from "@testing-library/react";
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

it("sign-up submits the account and moves to the code screen for that email", async () => {
  mutations.signUp.mutate.mockImplementation(
    (_input: unknown, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
  );
  const { user } = await renderScreen(() => <SignUpPage />);
  await user.type(screen.getByLabelText("Name"), "Person");
  await user.type(screen.getByLabelText("Email"), "p@example.test");
  await user.type(screen.getByLabelText("Password"), "correct horse battery");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(mutations.signUp.mutate.mock.calls[0]?.[0]).toEqual({
    displayName: "Person",
    email: "p@example.test",
    password: "correct horse battery",
  });
  expect(router.push).toHaveBeenCalledWith(
    "/verify-email?email=p%40example.test",
  );
});

it("verify-email prefills the address, submits the code, and can request another", async () => {
  const { user } = await renderScreen(() => <VerifyEmailPage />);
  expect(screen.getByLabelText("Email")).toHaveValue("p@example.test");
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
  expect(screen.getByLabelText("Email")).toBeDisabled();
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

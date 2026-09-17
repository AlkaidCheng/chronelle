"use client";

import type {
  EmailRequest,
  PasswordResetConfirmRequest,
  PasswordSignInRequest,
  SignInResponse,
  SignUpRequest,
  VerifyEmailRequest,
} from "@chronelle/schemas";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { readLocaleChoice } from "../i18n/locale-preference";
import { useApiClient } from "./api-context";
import { useAuthSession } from "./auth-session";
import { useAdoptAccountLocale } from "./queries";

/** Leaves an account screen once a session exists. */
export function useRedirectWhenSignedIn(): void {
  const auth = useAuthSession();
  const router = useRouter();
  useEffect(() => {
    if (auth.isHydrated && auth.credential !== null) router.replace("/events");
  }, [auth.credential, auth.isHydrated, router]);
}

function useSessionStart() {
  const { startSession } = useAuthSession();
  const adoptLocale = useAdoptAccountLocale();
  return (session: SignInResponse) => {
    adoptLocale(session.user);
    // The proxy set the session cookie; only the workspace is kept here.
    startSession({ workspaceId: session.workspace.id });
  };
}

/** Creates the account with the language this browser chose, when it chose one. */
export function useSignUp() {
  const client = useApiClient();
  return useMutation({
    mutationFn: (input: SignUpRequest) => {
      const choice = readLocaleChoice();
      return client.signUp({
        ...input,
        ...(choice === "system" ? {} : { locale: choice }),
      });
    },
  });
}

export function useVerifyEmail() {
  const client = useApiClient();
  const start = useSessionStart();
  return useMutation({
    mutationFn: (input: VerifyEmailRequest) => client.verifyEmail(input),
    onSuccess: start,
  });
}

export function useResendVerification() {
  const client = useApiClient();
  return useMutation({
    mutationFn: (input: EmailRequest) => client.resendVerification(input),
  });
}

export function usePasswordSignIn() {
  const client = useApiClient();
  const start = useSessionStart();
  return useMutation({
    mutationFn: (input: PasswordSignInRequest) =>
      client.signInWithPassword(input),
    onSuccess: start,
  });
}

export function useRequestPasswordReset() {
  const client = useApiClient();
  return useMutation({
    mutationFn: (input: EmailRequest) => client.requestPasswordReset(input),
  });
}

export function useConfirmPasswordReset() {
  const client = useApiClient();
  const start = useSessionStart();
  return useMutation({
    mutationFn: (input: PasswordResetConfirmRequest) =>
      client.confirmPasswordReset(input),
    onSuccess: start,
  });
}

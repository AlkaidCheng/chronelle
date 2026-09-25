"use client";

import type {
  AccountUpdateRequest,
  FriendInvitationPayload,
  FriendRequestRequest,
  SessionResponse,
} from "@livtales/schemas";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useApiClient } from "./api-context";
import { useAuthSession } from "./auth-session";
import { queryKeys } from "./queries";

/** Find people: accounts by @username, name, or exact email; nothing under two characters. */
export function useUserSearchQuery(query: string) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  const q = query.trim();
  return useQuery({
    enabled: credential !== null && q.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => client.withSignal(signal).searchUsers(q),
    queryKey: queryKeys.userSearch(q),
    staleTime: 10_000,
  });
}

/**
 * Whether a username is free, asked as it is typed on the sign-up screen
 * (no session needed): null while unknown or not asked.
 */
export function useUsernameAvailableQuery(username: string, enabled = true) {
  const client = useApiClient();
  return useQuery({
    enabled: enabled && username !== "",
    queryFn: ({ signal }) =>
      client.withSignal(signal).usernameAvailable(username),
    queryKey: ["users", "available", username] as const,
    staleTime: 10_000,
  });
}

/** The account behind a code, by username. */
export function useUserLookupQuery(username: string, enabled = true) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: enabled && credential !== null && username.trim() !== "",
    queryFn: ({ signal }) => client.withSignal(signal).getUser(username),
    queryKey: queryKeys.user(username),
    retry: false,
  });
}

/**
 * The name, the discovery switches, and the Welcome step's completion.
 * The session shows the change at once and again from the server's reply;
 * a refusal puts the previous values back.
 */
export function useUpdateAccount() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AccountUpdateRequest) => client.updateAccount(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.session });
      const previous = queryClient.getQueryData<SessionResponse>(
        queryKeys.session,
      );
      if (previous !== undefined)
        queryClient.setQueryData<SessionResponse>(queryKeys.session, {
          ...previous,
          user: {
            ...previous.user,
            ...(input.displayName !== undefined && {
              displayName: input.displayName.trim(),
            }),
            ...(input.findByName !== undefined && {
              findByName: input.findByName,
            }),
            ...(input.findByEmail !== undefined && {
              findByEmail: input.findByEmail,
            }),
          },
        });
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous !== undefined)
        queryClient.setQueryData(queryKeys.session, context.previous);
    },
    onSuccess: (user) => {
      const current = queryClient.getQueryData<SessionResponse>(
        queryKeys.session,
      );
      if (current !== undefined)
        queryClient.setQueryData<SessionResponse>(queryKeys.session, {
          ...current,
          user,
        });
    },
  });
}

/** The account's friends, the requests waiting for it, and what it sent. */
export function useFriendsQuery(enabled = true) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: enabled && credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).listFriends(),
    queryKey: queryKeys.friends,
  });
}

function useFriendsMutation<Input, Output>(
  run: (
    client: ReturnType<typeof useApiClient>,
    input: Input,
  ) => Promise<Output>,
) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Input) => run(client, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
      // Accepting may link a person card; the People page reads it again.
      void queryClient.invalidateQueries({ queryKey: queryKeys.persons });
      // How the account stands to others shows on search results and codes.
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useInviteFriend() {
  return useFriendsMutation((client, input: FriendInvitationPayload) =>
    client.inviteFriend(input),
  );
}

/** A request to an account found by search or by its code. */
export function useRequestFriend() {
  return useFriendsMutation((client, input: FriendRequestRequest) =>
    client.requestFriend(input),
  );
}

export function useAcceptFriendRequest() {
  return useFriendsMutation((client, id: string) =>
    client.acceptFriendRequest(id),
  );
}

export function useDeclineFriendRequest() {
  return useFriendsMutation((client, id: string) =>
    client.declineFriendRequest(id),
  );
}

export function useWithdrawInvitation() {
  return useFriendsMutation((client, id: string) =>
    client.withdrawFriendInvitation(id),
  );
}

export function useResendInvitation() {
  return useFriendsMutation((client, id: string) =>
    client.resendFriendInvitation(id),
  );
}

/** New link: the invitation's token is replaced, and the link handed out before stops working. */
export function useRenewInvitationLink() {
  return useFriendsMutation((client, id: string) =>
    client.renewFriendInvitationLink(id),
  );
}

export function useRemoveFriend() {
  return useFriendsMutation((client, id: string) => client.removeFriend(id));
}

/** What an invitation link opens, for the claim page; no session is needed. */
export function useInvitationPeekQuery(token: string) {
  const client = useApiClient();
  return useQuery({
    enabled: token !== "",
    queryFn: ({ signal }) => client.withSignal(signal).peekInvitation(token),
    queryKey: ["invitation", token] as const,
    retry: false,
  });
}

/** Accept on the claim page: the friendship, the shares, and (maybe) a card linked. */
export function useAcceptInvitation() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => client.acceptInvitation(token),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
      void queryClient.invalidateQueries({ queryKey: queryKeys.session });
      void queryClient.invalidateQueries({ queryKey: ["invitation"] });
    },
  });
}

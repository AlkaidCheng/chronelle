"use client";

import type { FriendInvitationPayload } from "@chronelle/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApiClient } from "./api-context";
import { useAuthSession } from "./auth-session";
import { queryKeys } from "./queries";

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
    },
  });
}

export function useInviteFriend() {
  return useFriendsMutation((client, input: FriendInvitationPayload) =>
    client.inviteFriend(input),
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

export function useRemoveFriend() {
  return useFriendsMutation((client, id: string) => client.removeFriend(id));
}

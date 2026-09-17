"use client";

import { useMemo } from "react";

import { useFriendsQuery } from "./friend-queries";
import { noConnections, type PersonConnections } from "./person-collection";
import { useSessionQuery } from "./queries";

/**
 * What the signed-in account knows about the workspace's people: the
 * accounts of its friends, and the cards of this workspace it has sent a
 * request or invitation from.
 */
export function usePersonConnections(enabled = true): PersonConnections {
  const friends = useFriendsQuery(enabled);
  const session = useSessionQuery();
  const workspaceId = session.data?.workspace.id;
  return useMemo(() => {
    if (friends.data === undefined) return noConnections;
    return {
      friends: new Set(friends.data.friends.map((friend) => friend.userId)),
      invited: new Set(
        friends.data.sent.flatMap((item) =>
          item.personId !== null &&
          (workspaceId === undefined || item.workspaceId === workspaceId)
            ? [item.personId]
            : [],
        ),
      ),
    };
  }, [friends.data, workspaceId]);
}

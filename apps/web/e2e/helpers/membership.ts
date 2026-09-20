import { type APIRequestContext, expect } from "@playwright/test";

interface Account {
  readonly accessToken: string;
  readonly user: { readonly id: string };
}

/**
 * Makes one account a member of another's workspace: the owner invites
 * the member as a friend, the member accepts, and the owner adds the
 * friend at the role. Membership is what the workspace switcher lists;
 * an event shared on its own shows in the member's own Events list.
 */
export async function addMember(
  request: APIRequestContext,
  owner: Account,
  member: Account & { readonly email: string },
  role: "editor" | "viewer" = "viewer",
): Promise<void> {
  const ownerHeaders = { authorization: `Bearer ${owner.accessToken}` };
  const sent = await request.post("/api/friends/invitations", {
    headers: ownerHeaders,
    data: { email: member.email },
  });
  expect(sent.status()).toBe(201);
  const accepted = await request.post(
    `/api/friends/requests/${(await sent.json()).id}/accept`,
    { headers: { authorization: `Bearer ${member.accessToken}` } },
  );
  expect(accepted.status()).toBe(200);
  const joined = await request.post("/api/workspaces/current/members", {
    headers: ownerHeaders,
    data: { friendId: (await accepted.json()).id, role },
  });
  expect(joined.status()).toBe(201);
}

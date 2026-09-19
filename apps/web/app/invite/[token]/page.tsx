import { InvitePage } from "../../../features/friends/invite-page";

/** The page an invitation link opens: who invited you, and Accept. */
export default async function InvitationPage({
  params,
}: {
  readonly params: Promise<{ readonly token: string }>;
}) {
  const { token } = await params;
  return <InvitePage token={token} />;
}

import { CodePage } from "../../../features/friends/code-page";

/** A profile code: the account behind a username, with Add friend. */
export default async function ProfileCodePage({
  params,
}: {
  readonly params: Promise<{ readonly username: string }>;
}) {
  const { username } = await params;
  return <CodePage username={username} />;
}

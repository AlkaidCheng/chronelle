import { PersonPage } from "../../../../features/people/person-page";

export default async function PersonRoute({
  params,
}: {
  readonly params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  return <PersonPage personId={personId} />;
}

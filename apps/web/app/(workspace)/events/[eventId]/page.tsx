import { EventWorkspace } from "../../../../features/events/event-workspace";

export default async function EventPage({
  params,
}: {
  readonly params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <EventWorkspace eventId={eventId} />;
}

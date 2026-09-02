# Object Model

The object platform will combine a common canonical envelope with typed domain
tables. The first vertical slice will implement `Trip`, `FlightInstance`,
`FlightBooking`, `Expense`, and `Document`.

## Canonical envelope

Every first-class object will receive one row in `objects` containing its UUID,
workspace, type, display name, creator, timestamps, version, archive and delete
markers, custom properties, and metadata. Domain tables will use the object ID
as their primary and foreign key.

Stable domain facts stay in typed tables. For example, flight schedules and
status belong to `flight_instances`, while PNR, ticket, seat, cabin, and paid
price belong to `flight_bookings`.

## Relationships

`object_relations` will connect canonical identities and can carry contextual
metadata. Removing a relation will soft-delete the relation without deleting
either endpoint.

Initial relation vocabulary includes:

- `Trip` includes `FlightBooking`
- `FlightBooking` is booking-for `FlightInstance`
- `Expense` is paid-for `FlightBooking`
- `Document` is attached-to `FlightBooking` or `Expense`

Calendar and table projections will resolve the booking and its referenced
flight instance at read time. Updating either canonical record will therefore
update every projection.

## Lifecycle

Objects use optimistic concurrency through an incrementing version. Ordinary
deletion sets `deleted_at`; permanent purge is a separate future workflow.

# CloudBase list read costs

CloudBase collection reads select authorized candidate IDs before hydrating
canonical records. Only the selected page loads full object properties and typed
payloads, task labels, or person contacts and labels. PostgreSQL TCP repositories
and public response schemas are unchanged.

## Bounded paths

- Event lists with an empty text query and updated ordering request `limit + 1`
  candidates. First-page chip counts are aggregated in SQL across the caller's own
  and shared root events; subsequent pages omit counts.
- Task lists with updated or manual ordering, an empty text query, and no due-day
  range request `limit + 1` candidates. Status, assignee, and label filters are
  applied before that limit.
- Revision lists request `limit + 1` summaries in descending version order. This
  includes the preceding snapshot needed to summarize the last visible revision.
  Single-revision reads find their preceding version with a descending, one-row
  range query. Neither operation downloads the full history.

The bounded candidate paths reduce gateway transfer; they do not guarantee an
index-only database plan. SQL still evaluates current visibility, filtering,
counts, and ordering before applying the page limit.

## Compatibility-sensitive paths

Name matching and ordering retain JavaScript's locale folding and comparison.
Name-based cursor comparisons retain their existing lexical semantics. Date/due
ordering uses that same name ordering for ties. These paths fetch lightweight
candidate metadata for all matching visible records and select the page in the
application. They are not fully bounded by page size.

Person lists fetch names and IDs before choosing the page. Task date-range queries
retain the runtime's IANA time-zone rules for timed tasks. Event date-only period
filtering retains UTC calendar-day boundaries. Updated-order candidates use
millisecond precision, matching the gateway-decoded timestamps and existing
cursors. The permission rules, list counts, cursor envelopes, canonical IDs,
contexts, and subtask progress remain unchanged.

Hydration rechecks visibility after candidate selection. A grant revoked or an
object moved into a private scope between those gateway reads can produce a
page shorter than its limit while a continuation cursor remains set. The page
omits inaccessible records; the cursor still advances past the selected
candidates.

## Validation and deployment

The integration fixture contains 320 events, 320 tasks, and 320 people, each with
4 KiB of custom properties. A 20-item updated/manual page returns 21 candidate
rows and hydrates at most 20 canonical rows per table. Name/date/due ordering still
returns 320 lightweight candidates, but hydrates only 20 canonical objects. A
2,000-revision fixture verifies bounded history and preceding-version queries.

Apply `0067_add_list_candidate_functions.sql` before deploying the API. Startup
readiness checks require its three public candidate functions. The migration is
additive and independent of `0066`; an older API continues to work after it is
applied. Production timings and query plans should be measured separately from the
local transport and SQL regression tests.

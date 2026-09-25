import type { ObjectSearchResult } from "@livtales/schemas";

export function getSearchResultHref(result: ObjectSearchResult): string | null {
  if (result.objectType === "event" && result.permissionScopeId === result.id) {
    return `/events/${result.id}`;
  }
  return result.permissionScopeId === result.id
    ? null
    : `/events/${result.permissionScopeId}`;
}

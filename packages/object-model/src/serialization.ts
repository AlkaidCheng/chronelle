import type { EventPlanningResource } from "./types.js";

function serializeDate(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function serializeResource(resource: EventPlanningResource) {
  const canonical = {
    id: resource.id,
    workspaceId: resource.workspaceId,
    objectType: resource.objectType,
    displayName: resource.displayName,
    createdBy: resource.createdBy,
    permissionScopeId: resource.permissionScopeId,
    createdAt: resource.createdAt.toISOString(),
    updatedAt: resource.updatedAt.toISOString(),
    version: resource.version,
    archivedAt: serializeDate(resource.archivedAt),
    deletedAt: serializeDate(resource.deletedAt),
    customProperties: resource.customProperties,
    metadata: resource.metadata,
  };

  switch (resource.objectType) {
    case "event":
      return {
        ...canonical,
        objectType: "event" as const,
        startsAt: serializeDate(resource.startsAt),
        startsOn: resource.startsOn,
        endsOn: resource.endsOn,
        endsAt: serializeDate(resource.endsAt),
        timezone: resource.timezone,
        isAllDay: resource.isAllDay,
      };
    case "task":
      return {
        ...canonical,
        objectType: "task" as const,
        status: resource.status,
        dueOn: resource.dueOn,
        dueAt: serializeDate(resource.dueAt),
        completedAt: serializeDate(resource.completedAt),
        parentTaskId: resource.parentTaskId,
        assigneeId: resource.assigneeId,
        location: resource.location,
        labelIds: [...resource.labelIds],
      };
    case "expense":
      return {
        ...canonical,
        objectType: "expense" as const,
        amount: resource.amount,
        currency: resource.currency,
        occurredAt: resource.occurredAt.toISOString(),
      };
    case "reminder":
      return {
        ...canonical,
        objectType: "reminder" as const,
        remindAt: resource.remindAt.toISOString(),
        status: resource.status,
      };
    case "document":
      return {
        ...canonical,
        objectType: "document" as const,
        storageProvider: resource.storageProvider,
        originalFilename: resource.originalFilename,
        mimeType: resource.mimeType,
        sizeBytes: resource.sizeBytes.toString(),
        checksumSha256: resource.checksumSha256,
        encryptionMode: resource.encryptionMode,
      };
    case "person":
      return {
        ...canonical,
        objectType: "person" as const,
        email: resource.email,
        userId: resource.userId,
      };
  }
}

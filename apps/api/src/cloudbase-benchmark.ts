import { setTimeout as delay } from "node:timers/promises";

import type { UserPrincipal } from "@chronelle/authorization";
import {
  disconnectedDatabase,
  type CloudBaseRdbClient,
  type CloudBaseRequestEvent,
} from "@chronelle/db";
import {
  CloudBaseCalendarReadRepository,
  CloudBaseEventReadRepository,
  CloudBasePersonReadRepository,
  CloudBaseProjectionReadRepository,
  CloudBaseSectionRepository,
  CloudBaseTaskReadRepository,
  EventPlanningProjectionService,
} from "@chronelle/object-model";

import type { AuthIdentity } from "./authentication/auth-provider.js";
import { CloudBaseIdentityStore } from "./identity/cloudbase-identity-store.js";

export const cloudBaseBenchmarkWorkloads = [
  "session",
  "events-updated",
  "events-name",
  "tasks-manual",
  "people-name",
  "attachment-targets",
  "panels",
] as const;

export type CloudBaseBenchmarkWorkload =
  (typeof cloudBaseBenchmarkWorkloads)[number];

interface UserRow {
  readonly id: unknown;
  readonly identity_provider: unknown;
  readonly provider_subject: unknown;
}

interface MemberRow {
  readonly workspace_id: unknown;
  readonly user_id: unknown;
}

interface ObjectRow {
  readonly id: unknown;
  readonly workspace_id: unknown;
  readonly object_type: unknown;
  readonly permission_scope_id: unknown;
}

interface BenchmarkFixture {
  readonly eventId: string;
  readonly identity: AuthIdentity;
  readonly inventory: Readonly<Record<string, number>>;
  readonly principal: UserPrincipal;
}

interface Sample {
  readonly elapsedMs: number;
  readonly failedCalls: number;
  readonly gatewayCalls: number;
  readonly gatewayTotalMs: number;
  readonly resultItems: number;
}

export interface Distribution {
  readonly maximum: number;
  readonly median: number;
  readonly minimum: number;
  readonly p95: number;
}

export interface CloudBaseBenchmarkResult {
  readonly elapsedMs: Distribution;
  readonly failedCalls: Distribution;
  readonly gatewayCalls: Distribution;
  readonly gatewayTotalMs: Distribution;
  readonly key: CloudBaseBenchmarkWorkload;
  readonly label: string;
  readonly resultItems: Distribution;
  readonly targets: Readonly<Record<string, number>>;
}

export interface CloudBaseBenchmarkReport {
  readonly finishedAt: string;
  readonly inventory: Readonly<Record<string, number>>;
  readonly methodology: string;
  readonly results: readonly CloudBaseBenchmarkResult[];
  readonly samples: number;
  readonly startedAt: string;
  readonly warmups: number;
}

export interface CloudBaseBenchmarkOptions {
  readonly client: CloudBaseRdbClient;
  readonly events: CloudBaseRequestEvent[];
  readonly samples: number;
  readonly warmups: number;
  readonly workloads: readonly CloudBaseBenchmarkWorkload[];
}

const benchmarkReadFunctions = new Set([
  "chronelle_event_list_candidates",
  "chronelle_identity_session_resolve",
  "chronelle_person_list_candidates",
  "chronelle_section_list",
  "chronelle_task_list_candidates",
  "chronelle_task_list_hydrate",
]);

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`CloudBase returned an invalid ${name}.`);
  return value;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) throw new Error("Cannot summarize no samples.");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)
  ] as number;
}

export function distribution(values: readonly number[]): Distribution {
  return {
    minimum: Math.min(...values),
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    maximum: Math.max(...values),
  };
}

export function cloudBaseBenchmarkClient(
  client: CloudBaseRdbClient,
): CloudBaseRdbClient {
  const blocked = (): never => {
    throw new Error("The CloudBase benchmark cannot perform mutations.");
  };
  return {
    capabilities: client.capabilities,
    select: <T>(...args: Parameters<CloudBaseRdbClient["select"]>) =>
      client.select<T>(...args),
    rpc: <T>(
      functionName: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      if (!benchmarkReadFunctions.has(functionName)) return blocked();
      return client.rpc<T>(functionName, args);
    },
    insert: blocked,
    update: blocked,
    delete: blocked,
  };
}

async function discoverFixture(
  client: CloudBaseRdbClient,
): Promise<BenchmarkFixture> {
  const [users, members, objects] = await Promise.all([
    client.select<UserRow>("users", {
      columns: "id,identity_provider,provider_subject",
    }),
    client.select<MemberRow>("workspace_members", {
      columns: "workspace_id,user_id",
    }),
    client.select<ObjectRow>("objects", {
      columns: "id,workspace_id,object_type,permission_scope_id",
      filters: [{ column: "deleted_at", operator: "is", value: null }],
    }),
  ]);
  const usersById = new Map(
    users.map((user) => [text(user.id, "user id"), user]),
  );
  const objectsByWorkspace = new Map<string, ObjectRow[]>();
  for (const object of objects) {
    const workspaceId = text(object.workspace_id, "workspace id");
    const bucket = objectsByWorkspace.get(workspaceId) ?? [];
    bucket.push(object);
    objectsByWorkspace.set(workspaceId, bucket);
  }
  const candidates = members
    .map((member) => {
      const workspaceId = text(member.workspace_id, "workspace id");
      const user = usersById.get(text(member.user_id, "member user id"));
      const workspaceObjects = objectsByWorkspace.get(workspaceId) ?? [];
      const event = workspaceObjects.find(
        (object) =>
          object.object_type === "event" &&
          object.permission_scope_id === object.id,
      );
      return { event, user, workspaceId, workspaceObjects };
    })
    .filter(
      (
        candidate,
      ): candidate is typeof candidate & {
        event: ObjectRow;
        user: UserRow;
      } => candidate.event !== undefined && candidate.user !== undefined,
    )
    .sort(
      (left, right) =>
        right.workspaceObjects.length - left.workspaceObjects.length,
    );
  const selected = candidates[0];
  if (selected === undefined)
    throw new Error(
      "No populated member workspace with a live root Event exists.",
    );

  const inventory: Record<string, number> = {};
  for (const object of selected.workspaceObjects) {
    const type = text(object.object_type, "object type");
    inventory[type] = (inventory[type] ?? 0) + 1;
  }
  return {
    eventId: text(selected.event.id, "event id"),
    identity: {
      displayName: "Benchmark account",
      email: null,
      provider: text(selected.user.identity_provider, "identity provider"),
      subject: text(selected.user.provider_subject, "identity subject"),
    },
    inventory,
    principal: {
      type: "user",
      userId: text(selected.user.id, "user id"),
      workspaceId: selected.workspaceId,
    },
  };
}

function sample(
  events: readonly CloudBaseRequestEvent[],
  elapsedMs: number,
  resultItems: number,
): Sample {
  return {
    elapsedMs,
    failedCalls: events.filter(({ outcome }) => outcome !== "ok").length,
    gatewayCalls: events.length,
    gatewayTotalMs: events.reduce(
      (total, event) => total + event.durationMs,
      0,
    ),
    resultItems,
  };
}

function targetCounts(
  events: readonly CloudBaseRequestEvent[],
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const event of events) {
    const key = `${event.kind}:${event.target}`;
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

/** Runs read-only application workloads against the configured CloudBase gateway. */
export async function runCloudBaseBenchmark(
  options: CloudBaseBenchmarkOptions,
): Promise<CloudBaseBenchmarkReport> {
  const startedAt = new Date().toISOString();
  const client = cloudBaseBenchmarkClient(options.client);
  const fixture = await discoverFixture(client);
  const clock = () => new Date();
  const identity = new CloudBaseIdentityStore(client, clock);
  const event = new CloudBaseEventReadRepository(client, clock);
  const task = new CloudBaseTaskReadRepository(client, clock);
  const person = new CloudBasePersonReadRepository(client, clock);
  const projections = new CloudBaseProjectionReadRepository(client, clock);
  const service = new EventPlanningProjectionService(
    disconnectedDatabase("The CloudBase benchmark is gateway-only").db,
    new CloudBaseCalendarReadRepository(client, clock),
    projections,
    undefined,
    new CloudBaseSectionRepository(client),
  );
  const workloads: Readonly<
    Record<
      CloudBaseBenchmarkWorkload,
      { readonly label: string; readonly run: () => Promise<number> }
    >
  > = {
    session: {
      label: "Authenticated identity resolution",
      run: async () =>
        (await identity.resolveSession(
          fixture.identity,
          fixture.principal.workspaceId,
        )) === null
          ? 0
          : 1,
    },
    "events-updated": {
      label: "Events updated page",
      run: async () =>
        (
          await event.listEvents(fixture.principal, {
            sort: "updated",
            limit: 20,
          })
        ).items.length,
    },
    "events-name": {
      label: "Events name page",
      run: async () =>
        (
          await event.listEvents(fixture.principal, {
            sort: "name",
            limit: 20,
          })
        ).items.length,
    },
    "tasks-manual": {
      label: "Tasks manual page",
      run: async () =>
        (
          await task.listTasks(fixture.principal, {
            sort: "manual",
            limit: 20,
          })
        ).items.length,
    },
    "people-name": {
      label: "People name page",
      run: async () =>
        (await person.listPersons(fixture.principal, { limit: 20 })).items
          .length,
    },
    "attachment-targets": {
      label: "Files attachment choices",
      run: async () => {
        const result = await service.getAttachmentTargets(
          fixture.principal,
          fixture.eventId,
        );
        return 1 + result.tasks.length + result.expenses.length;
      },
    },
    panels: {
      label: "Itinerary plus to-dos",
      run: async () => {
        const [itinerary, todos] = await Promise.all([
          service.getItinerary(fixture.principal, fixture.eventId),
          service.getTodos(fixture.principal, fixture.eventId),
        ]);
        return itinerary.items.length + todos.items.length;
      },
    },
  };

  const results: CloudBaseBenchmarkResult[] = [];
  for (const key of options.workloads) {
    const workload = workloads[key];
    const measured: Sample[] = [];
    const targets: Record<string, number> = {};
    for (
      let iteration = -options.warmups;
      iteration < options.samples;
      iteration += 1
    ) {
      options.events.length = 0;
      const sampleStartedAt = performance.now();
      const resultItems = await workload.run();
      const currentEvents = [...options.events];
      if (iteration >= 0) {
        measured.push(
          sample(
            currentEvents,
            performance.now() - sampleStartedAt,
            resultItems,
          ),
        );
        for (const [target, count] of Object.entries(
          targetCounts(currentEvents),
        ))
          targets[target] = (targets[target] ?? 0) + count;
      }
      if (iteration < options.samples - 1) await delay(60);
    }
    results.push({
      key,
      label: workload.label,
      elapsedMs: distribution(measured.map(({ elapsedMs }) => elapsedMs)),
      failedCalls: distribution(measured.map(({ failedCalls }) => failedCalls)),
      gatewayCalls: distribution(
        measured.map(({ gatewayCalls }) => gatewayCalls),
      ),
      gatewayTotalMs: distribution(
        measured.map(({ gatewayTotalMs }) => gatewayTotalMs),
      ),
      resultItems: distribution(measured.map(({ resultItems }) => resultItems)),
      targets: Object.fromEntries(
        Object.entries(targets).map(([target, count]) => [
          target,
          count / options.samples,
        ]),
      ),
    });
  }
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    samples: options.samples,
    warmups: options.warmups,
    inventory: fixture.inventory,
    methodology:
      "Read-only application adapters against the configured CloudBase HTTPS gateway. Elapsed time includes gateway, database, decoding, authorization, and adapter work. Gateway totals can exceed elapsed time when requests overlap.",
    results,
  };
}

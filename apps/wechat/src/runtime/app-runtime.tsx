import type { ChronelleApiClient } from "@chronelle/api-client";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useState,
} from "react";

import type { CloudBaseWeChatIdentity } from "../auth/cloudbase-identity";
import { createRuntimeCloudBaseIdentity } from "../auth/runtime-cloudbase-identity";
import { createRuntimeSessionStore } from "../auth/runtime-session-store";
import type { WeChatSessionStore } from "../auth/session-store";
import { createRuntimeApiClient } from "../api/runtime-client";
import type { EventDraftStore } from "../events/draft-store";
import {
  createRuntimeCommandId,
  createRuntimeEventDraftStore,
} from "../events/runtime-drafts";
import type { ExpenseDraftStore } from "../expenses/draft-store";
import { createRuntimeExpenseDraftStore } from "../expenses/runtime-drafts";
import type { ReminderDraftStore } from "../reminders/draft-store";
import { createRuntimeReminderDraftStore } from "../reminders/runtime-drafts";
import type { TaskDraftStore } from "../tasks/draft-store";
import { createRuntimeTaskDraftStore } from "../tasks/runtime-drafts";
import { readRuntimeConfig } from "./config";

export interface AppRuntime {
  readonly api: ChronelleApiClient;
  readonly apiBaseUrl: string;
  readonly createCommandId: () => Promise<string>;
  readonly eventDrafts: EventDraftStore;
  readonly expenseDrafts: ExpenseDraftStore;
  readonly identity: CloudBaseWeChatIdentity;
  readonly reminderDrafts: ReminderDraftStore;
  readonly sessions: WeChatSessionStore;
  readonly taskDrafts: TaskDraftStore;
}

export type AppRuntimeState =
  | { readonly status: "ready"; readonly runtime: AppRuntime }
  | { readonly status: "configuration-error"; readonly reason: string };

function createAppRuntime(): AppRuntimeState {
  const configured = readRuntimeConfig();
  if (!configured.ok)
    return { status: "configuration-error", reason: configured.reason };

  const sessions = createRuntimeSessionStore();
  const api = createRuntimeApiClient({
    baseUrl: configured.value.apiBaseUrl,
    getCredential: sessions.getCredential,
  });
  return {
    status: "ready",
    runtime: {
      api,
      apiBaseUrl: configured.value.apiBaseUrl,
      createCommandId: createRuntimeCommandId,
      eventDrafts: createRuntimeEventDraftStore(),
      expenseDrafts: createRuntimeExpenseDraftStore(),
      identity: createRuntimeCloudBaseIdentity(
        configured.value.cloudBaseEnvId,
        configured.value.useWxCloud,
      ),
      reminderDrafts: createRuntimeReminderDraftStore(),
      sessions,
      taskDrafts: createRuntimeTaskDraftStore(),
    },
  };
}

const AppRuntimeContext = createContext<AppRuntimeState | null>(null);

export function AppRuntimeProvider({ children }: PropsWithChildren) {
  const [runtime] = useState(createAppRuntime);
  return (
    <AppRuntimeContext.Provider value={runtime}>
      {children}
    </AppRuntimeContext.Provider>
  );
}

export function useAppRuntime(): AppRuntimeState {
  const runtime = useContext(AppRuntimeContext);
  if (runtime === null) throw new Error("AppRuntimeProvider is missing.");
  return runtime;
}

export function useReadyAppRuntime(): AppRuntime {
  const state = useAppRuntime();
  if (state.status !== "ready") {
    throw new Error("The Mini Program runtime is not configured.");
  }
  return state.runtime;
}

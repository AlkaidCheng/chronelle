import type { EventResponse, TaskResponse } from "@chronelle/schemas";
import { ApiClientError } from "@chronelle/api-client";
import { readEventSchedule } from "./event-schedule";
import type { EditorDraftSnapshot } from "./use-editor-draft";
import type { ContextCreateAttempt } from "./queries";
import type { readTaskFields } from "./task-fields";

export function readEventFields(event?: EventResponse) {
  return { displayName: event?.displayName ?? "", ...readEventSchedule(event) };
}

export type EventDraftSnapshot = EditorDraftSnapshot<
  EventResponse,
  ReturnType<typeof readEventFields>
> & { readonly kind: "event"; readonly creationAttempt?: ContextCreateAttempt };

export type TaskDraftSnapshot = EditorDraftSnapshot<
  TaskResponse,
  ReturnType<typeof readTaskFields>
> & { readonly kind: "task"; readonly creationAttempt?: ContextCreateAttempt };

export type RetainedDraftSnapshot = EventDraftSnapshot | TaskDraftSnapshot;

export function eventCreationDraftKeys(eventId: string) {
  return { schedule: `schedule:${eventId}`, task: `task:${eventId}` };
}

export function isDraftAccessError(error: unknown): boolean {
  return (
    error instanceof ApiClientError && [401, 403, 404].includes(error.status)
  );
}

interface KeptDraft {
  readonly snapshot: RetainedDraftSnapshot;
  readonly pending: boolean;
  readonly failed: boolean;
}

/** Retains up to twenty editor drafts within one authenticated tab session. */
export class EditorDraftStore {
  private readonly drafts = new Map<string, KeptDraft>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly signal: AbortSignal) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get(id: string): KeptDraft | undefined {
    return this.signal.aborted ? undefined : this.drafts.get(id);
  }

  get hasDrafts(): boolean {
    return !this.signal.aborted && this.drafts.size > 0;
  }

  canKeep(id: string): boolean {
    return (
      !this.signal.aborted &&
      (this.drafts.has(id) ||
        this.drafts.size < 20 ||
        [...this.drafts.values()].some((draft) => !draft.pending))
    );
  }

  keep(id: string, snapshot: RetainedDraftSnapshot): boolean {
    if (this.signal.aborted) return false;
    const previous = this.drafts.get(id);
    if (previous?.pending || previous?.snapshot === snapshot) return true;
    if (!previous && this.drafts.size >= 20) {
      const oldest = [...this.drafts].find(([, draft]) => !draft.pending);
      if (!oldest) return false;
      this.drafts.delete(oldest[0]);
    }
    this.drafts.delete(id);
    this.drafts.set(id, {
      snapshot,
      pending: false,
      failed: previous?.failed ?? false,
    });
    this.notify();
    return true;
  }

  forget(id: string) {
    if (this.drafts.delete(id)) this.notify();
  }

  clear() {
    this.drafts.clear();
    this.notify();
  }

  async save<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const draft = this.get(id);
    if (!draft || draft.pending)
      throw new Error("Wait for pending saves before trying again.");
    const saving = { ...draft, pending: true, failed: false };
    this.drafts.set(id, saving);
    this.notify();
    try {
      const saved = await operation();
      if (this.get(id) === saving) this.forget(id);
      return saved;
    } catch (error) {
      if (this.get(id) === saving) {
        if (isDraftAccessError(error)) this.forget(id);
        else {
          this.drafts.set(id, { ...draft, pending: false, failed: true });
          this.notify();
        }
      }
      throw error;
    }
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}

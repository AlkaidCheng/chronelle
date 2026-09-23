// The WeChat JavaScript runtime has no AbortController or AbortSignal, which
// TanStack Query, the CloudBase SDK, and request cancellation all construct.
// This module installs a minimal implementation where they are missing.

const dispatchAbort = Symbol("dispatchAbort");

interface AbortEvent {
  readonly type: "abort";
  readonly target: MiniProgramAbortSignal;
  readonly currentTarget: MiniProgramAbortSignal;
}

type AbortListener =
  ((event: AbortEvent) => void) | { handleEvent(event: AbortEvent): void };

function abortError(): Error {
  const error = new Error("This operation was aborted.");
  error.name = "AbortError";
  return error;
}

/** The signal of a {@link MiniProgramAbortController}; it fires "abort" once. */
export class MiniProgramAbortSignal {
  aborted = false;
  reason: unknown = undefined;
  onabort: ((event: AbortEvent) => void) | null = null;
  readonly #listeners = new Set<AbortListener>();

  addEventListener(type: string, listener: AbortListener | null): void {
    if (type === "abort" && listener !== null && !this.aborted) {
      this.#listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: AbortListener | null): void {
    if (type === "abort" && listener !== null) this.#listeners.delete(listener);
  }

  throwIfAborted(): void {
    if (this.aborted) throw this.reason;
  }

  [dispatchAbort](reason: unknown): void {
    if (this.aborted) return;
    this.aborted = true;
    this.reason = reason;
    const event: AbortEvent = {
      type: "abort",
      target: this,
      currentTarget: this,
    };
    const listeners = [...this.#listeners];
    this.#listeners.clear();
    for (const listener of this.onabort === null
      ? listeners
      : [this.onabort, ...listeners]) {
      try {
        if (typeof listener === "function") listener.call(this, event);
        else listener.handleEvent(event);
      } catch (error) {
        // A failing listener must not stop the others, as with EventTarget.
        setTimeout(() => {
          throw error;
        });
      }
    }
  }
}

export class MiniProgramAbortController {
  readonly signal = new MiniProgramAbortSignal();

  abort(reason?: unknown): void {
    this.signal[dispatchAbort](reason === undefined ? abortError() : reason);
  }
}

/** Installs the implementation on a global object that lacks AbortController. */
export function installAbortController(target: object = globalThis): void {
  const scope = target as { AbortController?: unknown; AbortSignal?: unknown };
  if (typeof scope.AbortController === "function") return;
  scope.AbortController = MiniProgramAbortController;
  scope.AbortSignal = MiniProgramAbortSignal;
}

installAbortController();

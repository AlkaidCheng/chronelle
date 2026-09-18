/**
 * Where to go after signing in, when a page that needs a session was
 * opened without one: kept on this tab, and only for the paths that make
 * sense to return to (a profile code today).
 */
const storageKey = "chronelle.after-sign-in";
const allowed = /^\/u\/[A-Za-z][A-Za-z0-9_-]{2,29}$/u;

export function rememberAfterSignIn(path: string): void {
  if (!allowed.test(path)) return;
  try {
    window.sessionStorage.setItem(storageKey, path);
  } catch {
    // Without storage the sign-in lands on Events, as always.
  }
}

/** The remembered path, taken so it is used once, or null. */
export function takeAfterSignIn(): string | null {
  try {
    const path = window.sessionStorage.getItem(storageKey);
    window.sessionStorage.removeItem(storageKey);
    return path !== null && allowed.test(path) ? path : null;
  } catch {
    return null;
  }
}

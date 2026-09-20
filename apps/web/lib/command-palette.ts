/**
 * Opening the command palette from outside the Search entry that owns it:
 * the phone's drawer asks for it once the drawer has closed. The entry
 * subscribes while mounted; a request with nothing mounted is dropped, as
 * outside a workspace there is no palette to open.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function openCommandPalette(): void {
  for (const listener of listeners) listener();
}

export function subscribeCommandPalette(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

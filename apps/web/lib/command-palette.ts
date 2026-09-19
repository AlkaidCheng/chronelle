/**
 * Opening the command palette from outside the Search entry that owns it:
 * the More menu asks for the palette at its Keyboard shortcuts section. The
 * entry subscribes while mounted; a request with nothing mounted is
 * dropped, as outside a workspace there is no palette to open.
 */
export type CommandPaletteSection = "shortcuts";

export interface CommandPaletteRequest {
  /** The section to open at, expanded and focused; the search field otherwise. */
  readonly section?: CommandPaletteSection | undefined;
}

type Listener = (request: CommandPaletteRequest) => void;

const listeners = new Set<Listener>();

export function openCommandPalette(request: CommandPaletteRequest = {}): void {
  for (const listener of listeners) listener(request);
}

export function subscribeCommandPalette(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

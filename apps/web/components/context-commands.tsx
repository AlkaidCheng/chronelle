"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

export interface ContextCommand {
  readonly id:
    | "edit-event"
    | "share-event"
    | "event-history"
    | "add-page"
    | "arrange-layout"
    | "add-component";
  readonly label: string;
  readonly description: string;
  /** The control the command presses; `run` replaces it for menu entries. */
  readonly target?: RefObject<HTMLButtonElement | null>;
  readonly run?: () => void;
}

interface CommandScopeProps {
  readonly pathname: string;
  readonly commands: readonly ContextCommand[];
}
type ScopedCommand = ContextCommand & { readonly isCurrent: () => boolean };
type RegisteredScope = CommandScopeProps & { active: boolean };
const CommandsContext = createContext<readonly ScopedCommand[]>([]);
const RegistrationContext = createContext<
  ((scope: CommandScopeProps) => () => void) | null
>(null);

export function WorkspaceCommandProvider({
  pathname,
  children,
}: {
  readonly pathname: string;
  readonly children: ReactNode;
}) {
  const route = useRef(pathname);
  useLayoutEffect(() => {
    route.current = pathname;
  }, [pathname]);
  const [scopes, setScopes] = useState<readonly RegisteredScope[]>([]);
  const register = useCallback((props: CommandScopeProps) => {
    const scope = { ...props, active: true };
    setScopes((current) => [...current, scope]);
    return () => {
      scope.active = false;
      setScopes((current) => current.filter((item) => item !== scope));
    };
  }, []);
  const commands = scopes
    .filter((scope) => scope.pathname === pathname)
    .flatMap((scope) =>
      scope.commands.map((command) => ({
        ...command,
        isCurrent: () => scope.active && route.current === scope.pathname,
      })),
    )
    .sort((first, second) => first.label.localeCompare(second.label));
  return (
    <RegistrationContext.Provider value={register}>
      <CommandsContext.Provider value={commands}>
        {children}
      </CommandsContext.Provider>
    </RegistrationContext.Provider>
  );
}

/** Registers current-page controls while their owning view is mounted. */
export function CommandScope({ pathname, commands }: CommandScopeProps) {
  const register = useContext(RegistrationContext);
  useLayoutEffect(
    () => register?.({ pathname, commands }),
    [register, pathname, commands],
  );
  return null;
}

export function useContextCommands() {
  return useContext(CommandsContext);
}

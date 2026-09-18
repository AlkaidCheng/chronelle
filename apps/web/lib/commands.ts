import { ApiClientError, type ChronelleApiClient } from "@chronelle/api-client";
import type {
  CommandExecutePayload,
  CommandReceipt,
  CommandStateResponse,
} from "@chronelle/schemas";
import type { QueryClient } from "@tanstack/react-query";
import { newId } from "./new-id";

export const commandsKey = ["commands"] as const;

/**
 * What a command did, in the words the Undo control names it with. The
 * server keeps no names on the stack, so this browser remembers the
 * commands it ran; after a reload the control still works but reads
 * "Undo edit" without the name.
 */
export interface CommandDescription {
  readonly kind: "rename" | "complete" | "reopen" | "move" | "edit";
  readonly name: string;
}

const descriptions = new Map<string, CommandDescription>();

export function describeCommand(
  commandId: string,
): CommandDescription | undefined {
  return descriptions.get(commandId);
}

/** Keeps the words for a command this browser ran; the last fifty are enough. */
export function rememberCommand(
  commandId: string,
  description: CommandDescription,
): void {
  descriptions.set(commandId, description);
  if (descriptions.size > 50)
    descriptions.delete(descriptions.keys().next().value as string);
}

/** The words for one edit, from the fields it touched and the name it left. */
export function commandDescription(
  patch: Record<string, unknown>,
  name: string,
): CommandDescription {
  const fields = Object.keys(patch).filter((key) => key !== "expectedVersion");
  if (fields.includes("displayName")) return { kind: "rename", name };
  if (fields.includes("status"))
    return { kind: patch.status === "done" ? "complete" : "reopen", name };
  if (fields.length > 0 && fields.every((key) => key === "rank"))
    return { kind: "move", name };
  return { kind: "edit", name };
}

export function readCommandState(
  client: ChronelleApiClient,
  queryClient: QueryClient,
  staleTime = 60_000,
): Promise<CommandStateResponse> {
  // A save waits on this read; a failure is the save's failure, not a retry.
  return queryClient.fetchQuery({
    queryKey: commandsKey,
    queryFn: () => client.getCommandState(),
    retry: false,
    staleTime,
  });
}

/**
 * Runs one content edit as a reversible command. The stack version comes
 * from the cached state, and a stale one (another tab of the same account
 * moved the stack) is refreshed once before the conflict is reported. The
 * receipt names the new stack state, which the cache adopts so the Undo
 * control is right before the state query refetches.
 */
export type CommandEditPayload = CommandExecutePayload["edits"][number];

export async function executeCommand(
  client: ChronelleApiClient,
  queryClient: QueryClient,
  edit: CommandEditPayload,
): Promise<CommandReceipt> {
  const attempt = (state: CommandStateResponse) =>
    client.executeCommand({
      operationId: newId(),
      expectedStackVersion: state.version,
      edits: [edit],
    });
  let receipt: CommandReceipt;
  try {
    receipt = await attempt(await readCommandState(client, queryClient));
  } catch (error) {
    if (
      !(error instanceof ApiClientError) ||
      error.code !== "command_stack_conflict"
    )
      throw error;
    receipt = await attempt(await readCommandState(client, queryClient, 0));
  }
  queryClient.setQueryData<CommandStateResponse>(commandsKey, {
    version: receipt.stackVersion,
    undo: { commandId: receipt.commandId, available: true },
    redo: null,
  });
  void queryClient.invalidateQueries({ queryKey: commandsKey });
  return receipt;
}

/**
 * The record as the command left it, composed from the copy on hand, the
 * patch, and the receipt's version, so a save settles the moment the write
 * is acknowledged; the read that follows corrects any server normalization.
 * Null when the record is not on hand.
 */
export function settledRecord<T extends { id: string; version: number }>(
  current: T | undefined,
  patch: Record<string, unknown>,
  receipt: CommandReceipt,
): T | null {
  if (current === undefined) return null;
  const version = receipt.objects.find((o) => o.id === current.id)?.version;
  if (version === undefined) return null;
  const { expectedVersion: _, ...fields } = patch;
  return {
    ...current,
    ...fields,
    version,
    updatedAt: new Date().toISOString(),
  };
}

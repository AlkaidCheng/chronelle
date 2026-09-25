import { z } from "zod";

export const databaseUrlSchema = z.url();

/**
 * Stops a deployment that still sets a renamed setting under its legacy
 * name, instead of letting it fall back to a default. Both names set to the
 * same value are accepted, so a service can keep the legacy name for as long
 * as a previous release that reads it may be rolled back to.
 */
export function assertRenamedVariable(
  environment: Readonly<Record<string, unknown>>,
  name: string,
  legacyName: string,
): void {
  const legacyValue = environment[legacyName];
  if (legacyValue === undefined || legacyValue === environment[name]) return;
  throw new Error(
    environment[name] === undefined
      ? `${legacyName} was renamed to ${name}. Set ${name} instead.`
      : `${legacyName} was renamed to ${name}, and the two are set to different values. Remove ${legacyName}.`,
  );
}

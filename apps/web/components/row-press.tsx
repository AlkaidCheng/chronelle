"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/**
 * A row's name and meta line as one button, "Edit <name>", that opens the
 * row in place as the composer. Where the rows cannot be edited the copy
 * renders alone.
 */
export function RowPress({
  children,
  name,
  onPress,
}: {
  readonly children: ReactNode;
  /** The record's name, for the button's accessible name. */
  readonly name: string;
  /** Opens the row; absent where the rows cannot be edited. */
  readonly onPress: (() => void) | undefined;
}) {
  const rows = useTranslations("rows");
  if (onPress === undefined) return <>{children}</>;
  return (
    <button
      aria-label={rows("edit", { name })}
      className="row-press"
      onClick={onPress}
      type="button"
    >
      {children}
    </button>
  );
}

"use client";

import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

/**
 * A square control that shows only its icon; the label is its accessible
 * name and the tooltip that appears on hover and focus.
 */
export function IconButton({
  label,
  children,
  className = "",
  tone = "quiet",
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly label: string;
  readonly children: ReactNode;
  readonly tone?: "quiet" | "primary";
  readonly ref?: Ref<HTMLButtonElement> | undefined;
}) {
  return (
    <button
      {...rest}
      ref={ref}
      type={rest.type ?? "button"}
      aria-label={rest["aria-label"] ?? label}
      data-tip={label}
      className={`icon-control icon-control-${tone} ${className}`.trim()}
    >
      {children}
    </button>
  );
}

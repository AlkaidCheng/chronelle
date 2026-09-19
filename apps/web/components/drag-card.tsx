"use client";

import type { ReactNode } from "react";

import type { DragState } from "../lib/use-row-drag";

/**
 * The card a lifted row becomes while the pointer drags it: the row's own
 * line, lifted with a shadow and a slight tilt, following the pointer. A
 * keyboard lift keeps the row in the list and shows no card.
 */
export function DragCard({
  children,
  drag,
}: {
  readonly children: ReactNode;
  readonly drag: DragState | null;
}) {
  if (drag === null || drag.keyboard) return null;
  return (
    <div
      aria-hidden="true"
      className="row-drag-card"
      style={{
        transform: `translate(${drag.x}px, ${drag.y}px) rotate(-0.6deg)`,
        width: drag.width,
      }}
    >
      {children}
    </div>
  );
}

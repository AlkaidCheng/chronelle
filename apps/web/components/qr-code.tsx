"use client";

import { encode } from "uqr";

/**
 * A QR code of the text as an SVG drawn with the current color on a white
 * ground, so a phone camera reads it in either theme. The matrix comes
 * from the encoder; nothing here is markup from outside.
 */
export function QrCode({
  value,
  label,
  size = 176,
}: {
  readonly value: string;
  readonly label: string;
  readonly size?: number | undefined;
}) {
  const { data, size: modules } = encode(value, { border: 2 });
  const cells: string[] = [];
  data.forEach((row, y) => {
    row.forEach((on, x) => {
      if (on) cells.push(`M${x},${y}h1v1h-1z`);
    });
  });
  return (
    <svg
      aria-label={label}
      className="qr-code"
      height={size}
      role="img"
      shapeRendering="crispEdges"
      viewBox={`0 0 ${modules} ${modules}`}
      width={size}
    >
      <rect fill="#fff" height={modules} width={modules} />
      <path d={cells.join("")} fill="#1d1b19" />
    </svg>
  );
}

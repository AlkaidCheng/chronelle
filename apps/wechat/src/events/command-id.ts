export function uuidV4FromBytes(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new TypeError("A UUID requires 16 bytes.");
  const normalized = Uint8Array.from(bytes);
  normalized[6] = ((normalized[6] ?? 0) & 0x0f) | 0x40;
  normalized[8] = ((normalized[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(normalized, (byte) =>
    byte.toString(16).padStart(2, "0"),
  );
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

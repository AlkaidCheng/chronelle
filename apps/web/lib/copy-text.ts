/** Puts text on the clipboard; false when the browser refuses or has none. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText(text);
    return navigator.clipboard !== undefined;
  } catch {
    return false;
  }
}

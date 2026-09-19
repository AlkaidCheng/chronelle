/**
 * Prints one view: the document is marked with the view being printed and
 * the panel with `data-printing`, which the print stylesheet reads to show
 * that panel alone, and both marks are cleared once the print dialog
 * closes. The browser's dialog offers Save as PDF.
 */
export function printPanel(panel: HTMLElement, view: string): void {
  const root = document.documentElement;
  root.dataset.printing = view;
  panel.dataset.printing = "true";
  window.addEventListener(
    "afterprint",
    () => {
      delete root.dataset.printing;
      delete panel.dataset.printing;
    },
    { once: true },
  );
  window.print();
}

/** The room a tip keeps from the viewport's sides. */
const edge = 12;
/** The gap between a control and its tip. */
const gap = 6;

/**
 * Places a control's `data-tip` tooltip: centred under the control when
 * that fits, else pulled inside the viewport by the edge margin. The tip
 * is the control's `::after`, fixed to the viewport so a strip that
 * clips its overflow never cuts it; its position reaches the stylesheet
 * as custom properties on the control.
 */
export function placeTip(control: HTMLElement) {
  const anchor = control.getBoundingClientRect();
  const width = Number.parseFloat(
    window.getComputedStyle(control, "::after").width,
  );
  const centre = anchor.left + anchor.width / 2;
  const left = Number.isNaN(width)
    ? centre
    : Math.min(
        Math.max(edge, centre - width / 2),
        window.innerWidth - width - edge,
      );
  control.style.setProperty("--tip-left", `${Math.round(left)}px`);
  control.style.setProperty(
    "--tip-top",
    `${Math.round(anchor.bottom + gap)}px`,
  );
}

/**
 * Places every `data-tip` tooltip as its control is hovered or focused;
 * returns the function that stops listening.
 */
export function watchTips(root: Document): () => void {
  const onTarget = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest<HTMLElement>("[data-tip]");
    if (control !== null) placeTip(control);
  };
  root.addEventListener("pointerover", onTarget);
  root.addEventListener("focusin", onTarget);
  return () => {
    root.removeEventListener("pointerover", onTarget);
    root.removeEventListener("focusin", onTarget);
  };
}

"use client";

import { type FormEventHandler, type ReactNode, useId } from "react";

/**
 * The attributes a row hands its control, tying it to the row's label and
 * caption.
 */
export interface SettingControl {
  readonly id?: string;
  readonly "aria-labelledby"?: string;
  readonly "aria-describedby"?: string;
}

/**
 * One setting as a row: its label and an optional caption at the left, its
 * compact control at the right, a hairline above it. On a narrow screen a
 * row too long for one line puts the control under the label.
 *
 * `kind` says how the label names the control: a `field` (a menu, a text
 * field, a switch) takes the row's id and the label is its `<label>`; a set
 * of `choices` points at the label with `aria-labelledby`; an `action` (a
 * button or a link) names itself, and the label is a heading of its own.
 * The caption describes the control either way. A row given `onSubmit` is
 * a form.
 */
export function SettingRow({
  label,
  caption,
  kind = "field",
  onSubmit,
  children,
}: {
  readonly label: ReactNode;
  readonly caption?: ReactNode;
  readonly kind?: "field" | "choices" | "action";
  readonly onSubmit?: FormEventHandler<HTMLFormElement> | undefined;
  readonly children: (control: SettingControl) => ReactNode;
}) {
  const id = useId();
  const controlId = `${id}-control`;
  const labelId = `${id}-label`;
  const captionId = `${id}-caption`;
  const described =
    caption === undefined ? {} : { "aria-describedby": captionId };
  const control: SettingControl =
    kind === "field"
      ? { id: controlId, ...described }
      : kind === "choices"
        ? { "aria-labelledby": labelId, ...described }
        : described;
  const body = (
    <>
      <div className="setting-row-text">
        {kind === "field" ? (
          <label className="setting-row-label" htmlFor={controlId}>
            {label}
          </label>
        ) : kind === "action" ? (
          <h3 className="setting-row-label">{label}</h3>
        ) : (
          <span className="setting-row-label" id={labelId}>
            {label}
          </span>
        )}
        {caption === undefined ? null : (
          <p className="setting-row-caption" id={captionId}>
            {caption}
          </p>
        )}
      </div>
      <div className="setting-row-control">{children(control)}</div>
    </>
  );
  return onSubmit === undefined ? (
    <div className="setting-row">{body}</div>
  ) : (
    <form className="setting-row" onSubmit={onSubmit}>
      {body}
    </form>
  );
}

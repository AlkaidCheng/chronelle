"use client";

import { useTranslations } from "next-intl";
import { type ComponentPropsWithoutRef, useRef } from "react";
import { canSubmitEditor } from "../lib/keyboard";
import { useEditorShortcut } from "../lib/shortcut-preference";

type EditorFormProps = Omit<
  ComponentPropsWithoutRef<"form">,
  | "onKeyDown"
  | "onCompositionStartCapture"
  | "onCompositionEndCapture"
  | "onBlurCapture"
>;

export function EditorForm(props: EditorFormProps) {
  const shortcut = useEditorShortcut();
  const composing = useRef<EventTarget | null>(null);
  return (
    <form
      {...props}
      onCompositionStartCapture={(event) => {
        composing.current = event.target;
      }}
      onCompositionEndCapture={() => {
        composing.current = null;
      }}
      onBlurCapture={(event) => {
        if (composing.current === event.target) composing.current = null;
      }}
      onKeyDown={(event) => {
        const form = event.currentTarget;
        if (
          shortcut.value !== "enabled" ||
          composing.current === event.target ||
          !canSubmitEditor(event.nativeEvent, form)
        )
          return;
        const submit = form.querySelector<HTMLButtonElement>(
          "button[data-editor-submit][type='submit']",
        );
        if (
          !submit ||
          submit.form !== form ||
          submit.matches(":disabled") ||
          form.getAttribute("aria-busy") === "true"
        )
          return;
        event.preventDefault();
        form.requestSubmit(submit);
      }}
    />
  );
}

export function EditorSubmitButton(
  props: Omit<ComponentPropsWithoutRef<"button">, "type">,
) {
  const t = useTranslations("editor");
  const shortcut = useEditorShortcut();
  const enabled = shortcut.value === "enabled" && !props.disabled;
  return (
    <button
      {...props}
      type="submit"
      data-editor-submit=""
      aria-keyshortcuts={enabled ? "Control+Enter Meta+Enter" : undefined}
      title={enabled ? t("shortcutTitle") : undefined}
    />
  );
}

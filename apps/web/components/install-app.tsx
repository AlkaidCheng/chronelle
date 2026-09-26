"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useState } from "react";

import { type InstallMode, useInstallApp } from "../lib/use-install-app";
import { useSessionDialog } from "../lib/use-session-dialog";
import { EditorDialogHeader } from "./editor-dialog-controls";

/**
 * The two steps Safari on iOS asks for, since it never prompts: Share,
 * then Add to Home Screen.
 */
function InstallSteps({ onClose }: { readonly onClose: () => void }) {
  const t = useTranslations("install");
  const common = useTranslations("common");
  const dialog = useSessionDialog(onClose);
  return (
    <dialog
      ref={dialog}
      className="event-create-dialog install-app-dialog"
      aria-labelledby="install-app-heading"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <EditorDialogHeader
        headingId="install-app-heading"
        title={t("dialogTitle")}
        closeLabel={common("close")}
        onClose={onClose}
      />
      <div className="event-create-body">
        <ol className="install-app-steps">
          <li>{t("iosStep1")}</li>
          <li>{t("iosStep2")}</li>
        </ol>
      </div>
      <footer className="event-create-footer">
        <button
          type="button"
          className="button button-primary"
          onClick={onClose}
        >
          {common("done")}
        </button>
      </footer>
    </dialog>
  );
}

/**
 * The app's own install control: raises the browser's prompt where the
 * browser offers one, shows the iOS steps where it does not. `mode` says
 * which, or "none" when there is nothing to offer (already installed, or a
 * browser without a prompt); `steps` is the open steps dialog to render.
 */
export function useInstallControl(): {
  readonly mode: InstallMode;
  readonly activate: () => void;
  readonly steps: ReactNode;
} {
  const install = useInstallApp();
  const [stepsOpen, setStepsOpen] = useState(false);
  const closeSteps = useCallback(() => setStepsOpen(false), []);
  const activate = useCallback(() => {
    if (install.mode === "prompt") void install.prompt();
    else if (install.mode === "ios") setStepsOpen(true);
  }, [install]);
  return {
    mode: install.mode,
    activate,
    steps: stepsOpen ? <InstallSteps onClose={closeSteps} /> : null,
  };
}

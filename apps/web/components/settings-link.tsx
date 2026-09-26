"use client";

import type { AnchorHTMLAttributes } from "react";
import { useAddress } from "../lib/location-store";
import { isPlainClick } from "../lib/plain-click";
import {
  openSettings,
  type SettingsSection,
  settingsHref,
} from "../lib/settings-address";

/**
 * A link that opens Settings at `section` over the current page. Its address
 * is the current page with that section, so a modified or middle click, or a
 * copied link, opens the same; a plain click runs `onOpen` (where a menu
 * closes and places focus for the dialog to return to) and opens Settings in
 * place, as a history entry Back closes.
 */
export function SettingsLink({
  section,
  onOpen,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick"> & {
  readonly section: SettingsSection;
  readonly onOpen: () => void;
}) {
  const address = useAddress();
  return (
    <a
      {...props}
      href={settingsHref(address, section)}
      onClick={(event) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        onOpen();
        openSettings(section);
      }}
    />
  );
}

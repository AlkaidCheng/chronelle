import { redirect } from "next/navigation";

/** The section's old address opens Settings at it over Events. */
export default function KeyboardSettingsRoute() {
  redirect("/events?settings=keyboard");
}

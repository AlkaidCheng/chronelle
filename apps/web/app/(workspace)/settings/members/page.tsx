import { redirect } from "next/navigation";

/**
 * The old address of a space's members opens Events; members are managed
 * from the space switcher's Manage space.
 */
export default function MembersSettingsRoute() {
  redirect("/events");
}

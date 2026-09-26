import { redirect } from "next/navigation";

/** The section's old address opens Settings at it over Events. */
export default function MembersSettingsRoute() {
  redirect("/events?settings=members");
}

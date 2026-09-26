import { redirect } from "next/navigation";

/** The section's old address opens Settings at it over Events. */
export default function AppearanceSettingsRoute() {
  redirect("/events?settings=appearance");
}

import { redirect } from "next/navigation";

/** Settings opens over the page it is chosen from; its old address, over Events. */
export default function SettingsRoute() {
  redirect("/events?settings=general");
}

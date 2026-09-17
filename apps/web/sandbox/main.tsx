import { NextIntlClientProvider } from "next-intl";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Providers } from "../app/providers";
import { WorkspaceShell } from "../components/workspace-shell";
import { EventList } from "../features/events/event-list";
import { EventWorkspace } from "../features/events/event-workspace";
import { FriendsPage } from "../features/friends/friends-page";
import { PeoplePage } from "../features/people/people-page";
import { PersonPage } from "../features/people/person-page";
import { TrashWorkspace } from "../features/recovery/trash-workspace";
import { ObjectSearch } from "../features/search/object-search";
import { SettingsPage } from "../features/settings/settings-page";
import { TasksPage } from "../features/tasks/tasks-page";
import en from "../messages/en.json";
import { store } from "./api-context";
import { useAuthSession } from "./auth-session";
import Link, { usePathname } from "./router";
import "../app/styles.css";
import "../app/collections.css";
import "./sandbox.css";

function Sandbox() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) window.scrollTo(0, 0);
  }, [pathname]);
  const session = useAuthSession();
  const [error, setError] = useState("");
  const eventId = /^\/events\/([\da-f-]+)$/.exec(pathname)?.[1];
  const personId = /^\/people\/([\da-f-]+)$/.exec(pathname)?.[1];
  function reset() {
    if (
      !window.confirm(
        "Replace all sandbox changes with fresh sample data? This cannot be undone.",
      )
    )
      return;
    try {
      store.reset();
      window.location.hash = "/events";
      session.setRole(session.role);
    } catch {
      setError(
        "Browser storage could not be reset. Your sample changes were preserved.",
      );
    }
  }
  return (
    <>
      <aside className="sandbox-banner" aria-label="Design sandbox controls">
        <div>
          <strong>Chronelle · Design sandbox</strong>
          <p>Sample data only. No server or account required.</p>
        </div>
        <label>
          Preview role{" "}
          <select
            value={session.role}
            onChange={(event) =>
              session.setRole(
                event.target.value === "viewer" ? "viewer" : "owner",
              )
            }
          >
            <option value="owner">Owner</option>
            <option value="viewer">Viewer</option>
          </select>
        </label>
        <button type="button" onClick={reset}>
          Reset sample data
        </button>
        <details>
          <summary>Sandbox limits</summary>
          <p>
            {store.notice} Use fictional data only. Real authentication,
            sharing, file transfers, history, trash and undo/redo require the
            full application. Viewer is a UI preview, not a security boundary.
            Reminder delivery is not simulated.
          </p>
        </details>
        {error && <p role="alert">{error}</p>}
      </aside>
      <WorkspaceShell>
        {eventId ? (
          <EventWorkspace key={eventId} eventId={eventId} />
        ) : pathname === "/events" ? (
          <EventList />
        ) : pathname === "/tasks" ? (
          <TasksPage />
        ) : personId ? (
          <PersonPage key={personId} personId={personId} />
        ) : pathname === "/people" ? (
          <PeoplePage />
        ) : pathname === "/search" ? (
          <ObjectSearch />
        ) : pathname === "/trash" ? (
          <TrashWorkspace />
        ) : pathname === "/friends" ? (
          <FriendsPage />
        ) : pathname === "/settings" ? (
          <SettingsPage section="account" />
        ) : pathname === "/settings/language" ? (
          <SettingsPage section="language" />
        ) : pathname === "/settings/appearance" ? (
          <SettingsPage section="appearance" />
        ) : (
          <section className="panel">
            <h1>No account needed</h1>
            <p>This is the browser-only design playground.</p>
            <Link href="/events">Return to Events</Link>
          </section>
        )}
      </WorkspaceShell>
    </>
  );
}

document.addEventListener("click", (event) => {
  if (
    event.target instanceof Element &&
    event.target.closest('a[href="#workspace-content"]')
  ) {
    event.preventDefault();
    document.getElementById("workspace-content")?.focus();
  }
});
const root = document.getElementById("sandbox-root");
if (!root) throw new Error("Sandbox root missing.");
createRoot(root).render(
  <NextIntlClientProvider locale="en" messages={en}>
    <Providers>
      <Sandbox />
    </Providers>
  </NextIntlClientProvider>,
);

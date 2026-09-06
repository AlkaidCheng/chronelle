"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { readonly reset: () => void }) {
  return (
    <main className="route-state surface">
      <p className="eyebrow">Chronelle</p>
      <h1>Something interrupted this page</h1>
      <p>
        Your saved plans are still there. Try opening the page again, or return
        to your events. Any unsaved changes may need to be entered again.
      </p>
      <div className="form-actions">
        <button className="button button-primary" type="button" onClick={reset}>
          Try again
        </button>
        <Link className="button button-secondary" href="/events">
          Back to events
        </Link>
      </div>
    </main>
  );
}

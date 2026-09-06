import Link from "next/link";

export default function NotFound() {
  return (
    <main className="route-state surface">
      <p className="eyebrow">Chronelle</p>
      <h1>This page is not here</h1>
      <p>
        The link may have changed. Your workspace is a good place to start
        again.
      </p>
      <Link className="button button-primary" href="/events">
        Back to events
      </Link>
    </main>
  );
}

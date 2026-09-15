import type { ReactNode } from "react";

/** The two-column frame every account screen shares: the brand intro and a form. */
export function AccountPage({
  children,
  footnote,
}: {
  readonly children: ReactNode;
  readonly footnote?: string | undefined;
}) {
  return (
    <main className="sign-in-page">
      <section className="sign-in-intro">
        <a className="brand brand-light" href="/sign-in">
          <span className="brand-mark">C</span>
          <span>Chronelle</span>
        </a>
        <div>
          <p className="eyebrow eyebrow-light">Life, thoughtfully connected</p>
          <h1>Make every plan part of your story.</h1>
          <p>
            The people, plans, and little details that make life yours. Bring
            them together, one event at a time.
          </p>
        </div>
        {footnote === undefined ? null : (
          <p className="sign-in-footnote">{footnote}</p>
        )}
      </section>
      <section className="sign-in-form-wrap">{children}</section>
    </main>
  );
}

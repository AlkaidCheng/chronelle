const foundations = [
  {
    description:
      "People, trips, bookings, expenses, and documents keep one stable identity.",
    label: "Canonical objects",
    marker: "01",
  },
  {
    description:
      "First-class links place one object in every context where it belongs.",
    label: "Connected context",
    marker: "02",
  },
  {
    description:
      "Every person, integration, and future assistant follows one access decision.",
    label: "Consistent access",
    marker: "03",
  },
] as const;

export default function Home() {
  return (
    <main>
      <nav aria-label="Primary navigation" className="navigation">
        <a className="wordmark" href="#top">
          Chronelle
        </a>
        <span className="phase">Foundation</span>
      </nav>

      <section className="hero" id="top">
        <p className="eyebrow">A living chronicle of your journey</p>
        <h1>Your life, connected across time.</h1>
        <p className="introduction">
          Chronelle brings the plans, places, people, records, and memories of a
          life into one structured and interconnected home.
        </p>
        <div className="status" role="status">
          <span aria-hidden="true" className="statusDot" />
          The Chronelle foundation is running
        </div>
      </section>

      <section aria-labelledby="principles-heading" className="principles">
        <div className="sectionHeading">
          <p className="eyebrow">Built to stay coherent</p>
          <h2 id="principles-heading">One story, many useful views.</h2>
        </div>
        <div className="principleGrid">
          {foundations.map((foundation) => (
            <article className="principle" key={foundation.marker}>
              <span>{foundation.marker}</span>
              <h3>{foundation.label}</h3>
              <p>{foundation.description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

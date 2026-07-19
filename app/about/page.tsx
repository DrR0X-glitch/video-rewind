import Link from "next/link";

export default function AboutPage() {
  return (
    <div className="about-page">
      <header className="about-hero">
        <p className="eyebrow">About Video Rewind</p>
        <h1>Physical media, shelved properly, with no algorithm in the middle.</h1>
        <p className="about-deck">
          Video Rewind is for people who still like browsing titles, comparing formats, and choosing something that
          stays available tomorrow.
        </p>
      </header>

      <section className="about-section">
        <p className="about-lead">
          Streaming is convenient. Physical media is stable. We keep the collection in formats that hold up in the
          real world: DVD, Blu-ray, 4K UHD, and the occasional archival oddity when it belongs on a shelf.
        </p>
        <ul className="about-list">
          <li>Complete editions and bonus features</li>
          <li>No disappearing catalogue problem</li>
          <li>Real shelves, real cover art, real recommendations</li>
          <li>Clear copy counts and format choices</li>
        </ul>
      </section>

      <section className="about-section">
        <p>
          The app follows the same idea. Search the public catalogue, browse by row, and use the collection without
          extra noise getting in the way.
        </p>
        <p>
          Everything stays flat, readable, and direct. No decorative noise, no hidden controls, just the paths people
          actually need.
        </p>
      </section>

      <section className="about-quote">
        <p className="about-closing">
          At Video Rewind, the point is not just to rent a movie. It is to make the choice feel worth making.
        </p>
        <p className="about-tagline">Because some things are worth rewinding.</p>
        <p className="about-link-row">
          <Link href="/search">Search the Catalogue</Link>
        </p>
      </section>
    </div>
  );
}

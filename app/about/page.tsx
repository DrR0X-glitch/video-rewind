export default function AboutPage() {
  return (
    <div className="about-page">
      <section className="panel section about-panel">
        <div className="about-hero">
          <div className="about-hero-copy">
            <p className="eyebrow">About Video Rewind</p>
            <h1>In a world of disappearing libraries decision fatigue, Video Rewind exists for people who want something real.</h1>
            <p className="about-deck">
              We&apos;re a modern video rental store built on a simple belief: movies, shows, and music deserve to be experienced at their best, always, not once from an ever-changing catalogue.
            </p>
          </div>
          <div className="about-sticker">
            <span>Movies,</span>
            <span>Done Right</span>
          </div>
        </div>

        <div className="about-body">
          <div className="about-column">
            <p className="about-lead">
              That&apos;s why we specialize in physical media. From Blu-ray and 4K UHD to DVD and even VHS, every format we carry offers something streaming can&apos;t fully replicate: consistent quality, complete editions, and the assurance that what you love won&apos;t suddenly vanish overnight.
            </p>
            <p>
              But Video Rewind isn&apos;t just about resolution and bitrate. It&apos;s about connection.
            </p>
            <p>
              Walking through our doors is a throwback to a time when discovering something to watch was an experience in itself. The shelves, the cover art, the staff picks, the quiet debates over what to take home. It&apos;s all part of the ritual. For some, it&apos;s nostalgia. For others, it&apos;s something entirely new.
            </p>
          </div>

          <div className="about-column">
            <div className="about-side-block">
              <p className="eyebrow">Why Physical</p>
              <ul className="about-list">
                <li>Consistent picture and sound quality</li>
                <li>Complete editions and bonus features</li>
                <li>No disappearing catalogue problems</li>
                <li>Real shelves, real cover art, real recommendations</li>
              </ul>
            </div>
            <p>
              We curate our collection with care, highlighting everything from cult classics and forgotten gems to the latest releases in their highest-quality formats. No algorithms. No autoplay. Just real recommendations from people who love film as much as you do.
            </p>
          </div>
        </div>

        <div className="about-quote">
          <p className="about-closing">
            At Video Rewind, you&apos;re not just renting a movie. You&apos;re reclaiming the experience of choosing it, holding it, and truly owning it.
          </p>
          <p className="about-tagline">Because some things are worth rewinding.</p>
        </div>
      </section>
    </div>
  );
}

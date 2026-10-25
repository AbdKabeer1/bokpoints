import { useEffect, useState } from 'react';

const NAME = 'OmaPointii'.split('');

/**
 * The first thing anyone sees: each letter rises into place, the green dot
 * lands, the tagline settles, then the whole thing fades to the sign-in.
 * Short on purpose (about 2.7 seconds) and near-instant when the browser
 * asks for reduced motion — the same intro the customer app plays.
 */
export function Splash({ tagline, onDone }: { tagline: string; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hold = reduced ? 900 : 2450;
    const leaveTimer = window.setTimeout(() => setLeaving(true), hold);
    const doneTimer = window.setTimeout(onDone, hold + 280);
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div
      className={leaving ? 'splash splash-leaving' : 'splash'}
      role="heading"
      aria-label="OmaPointii"
    >
      <div className="splash-row">
        {NAME.map((letter, index) => (
          <span
            key={index}
            className="splash-letter"
            style={{ animationDelay: `${index * 60}ms` }}
            aria-hidden="true"
          >
            {letter}
          </span>
        ))}
        <span className="splash-dot" aria-hidden="true" />
      </div>
      <p className="splash-tagline">{tagline}</p>
    </div>
  );
}

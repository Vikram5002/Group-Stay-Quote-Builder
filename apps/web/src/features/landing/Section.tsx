import type { CSSProperties, ReactNode } from 'react';
import { Reveal } from './motion';

/** A landing section: eyebrow with a small colour dot, a large title, an optional lead. */
export function Section({
  id,
  eyebrow,
  title,
  lead,
  dot = 'var(--lp-blue)',
  tone = 'white',
  children,
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  dot?: string;
  tone?: 'white' | 'grey';
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={`scroll-mt-20 py-20 md:py-28 ${tone === 'grey' ? 'bg-[var(--lp-bg)]' : 'bg-white'}`}
    >
      <div className="mx-auto max-w-6xl px-4">
        <Reveal className="max-w-3xl">
          <p className="lp-eyebrow" style={{ '--lp-dot': dot } as CSSProperties}>
            {eyebrow}
          </p>
          <h2 id={`${id}-title`} className="lp-h2 lp-wipe mt-4">
            {title}
          </h2>
          {lead && <p className="lp-lead mt-4">{lead}</p>}
        </Reveal>
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

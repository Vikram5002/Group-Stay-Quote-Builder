import {
  IconArrowUpRight,
  IconBed,
  IconClock,
  IconHistory,
  IconList,
  IconQuestion,
  IconScale,
  IconShield,
  IconUpload,
} from './icons';
import { Reveal, spotlight } from './motion';
import { Section } from './Section';

const FEATURES = [
  {
    icon: IconScale,
    title: 'A live margin meter',
    text: 'See contribution against your minimum as you type the rate, with the lowest safe rate worked out for you.',
  },
  {
    icon: IconBed,
    title: 'Rooms that cannot be sold twice',
    text: 'Holds are taken for every night of a quote or none. Twenty requests for ten rooms produce one hold.',
  },
  {
    icon: IconClock,
    title: 'Quotes that expire on their own',
    text: 'Each quote has a deadline. When it passes, the rooms are released without anyone remembering to.',
  },
  {
    icon: IconShield,
    title: 'Owner approval, two sets of eyes',
    text: 'A quote below your minimum waits for an Owner. The person who made it cannot approve it.',
  },
  {
    icon: IconList,
    title: 'Every decision explained',
    text: 'Reasons and an arithmetic trail sit beside each result, so a number can always be traced to its inputs.',
  },
  {
    icon: IconQuestion,
    title: 'Unknown is never zero',
    text: 'A missing cost shows as Unknown and sends the quote for review, instead of quietly looking profitable.',
  },
  {
    icon: IconUpload,
    title: 'Import and export',
    text: 'Load rooms and rates from CSV or JSON with a row-by-row report, and export quotes as CSV or JSON.',
  },
  {
    icon: IconHistory,
    title: 'A full audit trail',
    text: 'Who created, approved, extended or cancelled each quote, and when, in India time with the exact UTC instant.',
  },
];

export function Features() {
  return (
    <Section
      id="features"
      eyebrow="Features"
      title="Built so a rushed quote cannot lose money."
      dot="var(--lp-orange)"
      tone="grey"
    >
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" onPointerMove={spotlight}>
        {FEATURES.map((f, i) => {
          const Icon = f.icon;
          return (
            <Reveal as="li" key={f.title} delay={(i % 4) * 70}>
              <article className="lp-card lp-card--lift lp-card--white lp-spot h-full min-h-60">
                <IconArrowUpRight className="lp-arrow size-5" />
                <span className="lp-icon-disc bg-[var(--lp-card)]">
                  <Icon className="size-6" />
                </span>
                <h3 className="lp-h3 mt-7">{f.title}</h3>
                <p className="lp-muted mt-2 text-sm">{f.text}</p>
              </article>
            </Reveal>
          );
        })}
      </ul>
    </Section>
  );
}

import type { CSSProperties } from 'react';
import { IconArrowUpRight, IconCalculator, IconCalendar, IconClock, IconPercent } from './icons';
import { Reveal, spotlight } from './motion';
import { Section } from './Section';

const PAINS = [
  {
    icon: IconCalendar,
    title: 'Checking availability manually',
    text: 'Are enough rooms available for every night of the requested stay? One missed date can create a booking problem later.',
  },
  {
    icon: IconCalculator,
    title: 'Calculating the quote from scratch',
    text: 'Room rates, number of rooms, number of nights and additional costs. You have to get every number right before sending the offer.',
  },
  {
    icon: IconPercent,
    title: 'Guessing how much to discount',
    text: 'The customer wants a better rate. Should you offer 5%, 10% or more? How much room do you have to negotiate without hurting your margins?',
  },
  {
    icon: IconClock,
    title: 'Taking too long to respond',
    text: "While you're checking spreadsheets, doing calculations or discussing rates, your customer may already be contacting another hotel.",
  },
];

export function Familiar() {
  return (
    <Section
      id="familiar"
      eyebrow="Does this sound familiar?"
      title="Another group enquiry. Another round of calculations."
      dot="var(--lp-orange)"
    >
      <ul className="grid gap-4 sm:grid-cols-2" onPointerMove={spotlight}>
        {PAINS.map((p, i) => {
          const Icon = p.icon;
          return (
            <Reveal as="li" key={p.title} delay={(i % 2) * 90}>
              <article className="lp-card lp-card--lift lp-spot h-full min-h-56">
                <IconArrowUpRight className="lp-arrow size-6" />
                <span
                  className="lp-icon-disc lp-ripple"
                  style={{ '--rd': `${i * 0.8}s` } as CSSProperties}
                >
                  <Icon className="size-6" />
                </span>
                <h3 className="lp-h3 mt-8">{p.title}</h3>
                <p className="lp-muted mt-2">{p.text}</p>
              </article>
            </Reveal>
          );
        })}
      </ul>
      <Reveal className="mt-12 max-w-3xl">
        <p className="text-2xl font-medium leading-snug tracking-tight md:text-3xl">
          Your problem isn&apos;t getting enquiries.{' '}
          <span className="lp-muted">
            It&apos;s turning them into the right bookings efficiently.
          </span>
        </p>
      </Reveal>
    </Section>
  );
}

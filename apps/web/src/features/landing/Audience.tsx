import { IconCheck, IconHotel, IconUsers, IconBed } from './icons';
import type { CSSProperties } from 'react';
import { Reveal, spotlight } from './motion';
import { Section } from './Section';

const AUDIENCES = [
  {
    icon: IconHotel,
    title: 'Independent and budget hotels',
    text: 'Handle group enquiries without depending entirely on manual calculations.',
    points: ['Availability checked night by night', 'Prices worked out the same way every time'],
  },
  {
    icon: IconUsers,
    title: 'Small hotel teams',
    text: 'Use a more consistent quotation process even when the owner or manager is handling multiple responsibilities.',
    points: ['One workflow for everyone', 'Service Manager approval when a discount goes too far'],
  },
  {
    icon: IconBed,
    title: 'Hotels serving group travellers',
    text: 'Prepare quotations for family gatherings, tour groups, corporate stays, wedding guests and other multi-room enquiries.',
    points: ['Family gatherings and tour groups', 'Corporate stays and wedding guests'],
  },
];

export function Audience() {
  return (
    <Section
      id="who"
      eyebrow="Who it's for"
      title="Built for hotels where every group enquiry matters."
      dot="#9f80f8"
    >
      <ul className="grid gap-4 md:grid-cols-3" onPointerMove={spotlight}>
        {AUDIENCES.map((a, i) => {
          const Icon = a.icon;
          return (
            <Reveal as="li" key={a.title} delay={i * 90}>
              <article className="lp-card lp-card--lift lp-spot h-full">
                <span className="lp-icon-disc">
                  <Icon className="size-6" />
                </span>
                <h3 className="lp-h3 mt-6">{a.title}</h3>
                <p className="lp-muted mt-2">{a.text}</p>
                <ul className="mt-5 space-y-2.5 border-t border-[var(--lp-line)] pt-5">
                  {a.points.map((p, n) => (
                    <li key={p} className="flex items-start gap-2.5 text-sm font-medium">
                      <span
                        className="lp-tick mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success"
                        style={{ '--i': i * 2 + n } as CSSProperties}
                      >
                        <IconCheck className="size-3.5" />
                      </span>
                      {p}
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          );
        })}
      </ul>
      <Reveal className="mt-10 max-w-3xl">
        <p className="text-xl font-medium leading-snug tracking-tight md:text-2xl">
          Whether you have 10 rooms or 25, the goal is the same:{' '}
          <span className="lp-muted">
            make each group quotation easier to prepare and easier to evaluate.
          </span>
        </p>
      </Reveal>
    </Section>
  );
}

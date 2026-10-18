import { IconPlus } from './icons';
import { Reveal } from './motion';
import { Section } from './Section';

/** Answers describe what the product does today, and say plainly what it does not do yet. */
const FAQS = [
  {
    q: 'What happens if I offer a discount that is too low?',
    a: "StayQuote compares the booking's contribution with your minimum. If it falls short, the quote goes to a Service Manager for approval, and the person who made the quote cannot approve it themselves.",
  },
  {
    q: 'Will it let me promise rooms I do not have?',
    a: 'No. Rooms are counted night by night. If only 10 are free on every night, a request for 12 becomes a partial offer of 10, and a quote holds its rooms until it expires so two quotes cannot claim the same room.',
  },
  {
    q: 'What if I do not know a cost yet?',
    a: 'Leave it unknown. StayQuote shows it as Unknown, never as zero, and sends the quote for review instead of quietly looking profitable.',
  },
  {
    q: 'Can it send the quotation to my customer?',
    a: 'Not yet. It prepares the quotation with its calculation and validity, and you can download the quote as a file. Sending by email or as a PDF is not built.',
  },
  {
    q: 'Who can do what?',
    a: 'Reception builds, issues, confirms and cancels quotes. Service Managers approve or reject quotes below the minimum, set the policy and import rooms and rates. Viewers can see everything but change nothing.',
  },
  {
    q: 'Is the data on this page real?',
    a: 'No. StayQuote is a case study built for Fynd × NMIMS Hyderabad (Case C32). The numbers use a small sample hotel with synthetic data, so they show how the workflow behaves, not real revenue or real demand.',
  },
];

export function Faq() {
  return (
    <Section
      id="faq"
      eyebrow="FAQs"
      title="Questions a hotel owner would ask."
      dot="var(--lp-orange)"
      tone="grey"
    >
      <Reveal className="max-w-3xl">
        <div className="divide-y divide-[var(--lp-line)] rounded-[1.5rem] bg-white px-6 ring-1 ring-[var(--lp-line)]">
          {FAQS.map((f) => (
            <details key={f.q} className="lp-faq group py-5">
              <summary className="flex min-h-11 items-center justify-between gap-4 text-lg font-semibold tracking-tight">
                {f.q}
                <span className="lp-faq-plus flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--lp-card)]">
                  <IconPlus className="size-5" />
                </span>
              </summary>
              <p className="lp-faq-body lp-muted mt-3 max-w-2xl pr-12">{f.a}</p>
            </details>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}

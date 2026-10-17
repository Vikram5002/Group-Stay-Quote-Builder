import { IconArrowUpRight, IconClock, IconList, IconPercent, IconShield } from './icons';
import { Reveal, spotlight } from './motion';
import { Section } from './Section';

const VALUES = [
  {
    icon: IconClock,
    title: 'Respond while the customer is still interested.',
    text: 'Reduce the manual work involved in preparing a group quotation so you can focus on the enquiry and the customer.',
  },
  {
    icon: IconPercent,
    title: 'Offer discounts with a reason.',
    text: "Understand how different prices affect the booking's contribution instead of negotiating blindly.",
  },
  {
    icon: IconShield,
    title: 'Avoid preventable quotation errors.',
    text: 'Use a consistent calculation process for rooms, nights, rates and availability.',
  },
  {
    icon: IconList,
    title: 'Make group enquiries easier to manage.',
    text: 'Spend less effort switching between calculations and more effort evaluating the booking opportunity.',
  },
];

export function Value() {
  return (
    <Section
      id="value"
      eyebrow="The value for your hotel"
      title="A better quotation is more than just a number."
      dot="var(--lp-green)"
      tone="grey"
    >
      <ul className="grid gap-4 md:grid-cols-2" onPointerMove={spotlight}>
        {VALUES.map((v, i) => {
          const Icon = v.icon;
          return (
            <Reveal as="li" key={v.title} delay={(i % 2) * 90}>
              <article className="lp-card lp-card--lift lp-card--white lp-spot h-full min-h-52">
                <IconArrowUpRight className="lp-arrow size-6" />
                <span className="lp-icon-disc bg-[var(--lp-card)]">
                  <Icon className="size-6" />
                </span>
                <h3 className="lp-h3 mt-8 max-w-sm">{v.title}</h3>
                <p className="lp-muted mt-2 max-w-md">{v.text}</p>
              </article>
            </Reveal>
          );
        })}
      </ul>
    </Section>
  );
}

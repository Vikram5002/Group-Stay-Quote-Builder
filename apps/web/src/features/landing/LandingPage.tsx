import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { SignInLink } from './SignInLink';
import './landing.css';
import './motion.css';
import { Audience } from './Audience';
import { Calculator } from './Calculator';
import { Faq } from './Faq';
import { Familiar } from './Familiar';
import { Features } from './Features';
import { Hero } from './Hero';
import { HoldClock } from './HoldClock';
import { HowItWorks } from './HowItWorks';
import { IconArrowRight, LogoMark } from './icons';
import { Introducing } from './Introducing';
import { prefersReducedMotion, Reveal, useScrollY } from './motion';
import { Value } from './Value';

const NAV = [
  ['how', 'How it works'],
  ['features', 'Features'],
  ['faq', 'FAQs'],
] as const;

/** Sections that light up a menu item while they are under the middle of the screen. */
const NAV_FOR: Record<string, string> = {
  how: 'how',
  features: 'features',
  holds: 'features',
  faq: 'faq',
};
const SECTION_IDS = [
  'familiar',
  'introducing',
  'how',
  'value',
  'try',
  'features',
  'holds',
  'who',
  'faq',
];

const FOOTER_LINKS = [
  ['how', 'How it works'],
  ['features', 'Features'],
  ['faq', 'FAQs'],
] as const;

/** Smooth scroll to a section, unless the visitor asked for less motion. */
function jump(e: MouseEvent<HTMLAnchorElement>, id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  history.replaceState(null, '', `#${id}`);
}

export function LandingPage() {
  const bar = useRef<HTMLDivElement>(null);
  const y = useScrollY();
  const [active, setActive] = useState<string | null>(null);
  const [tryInView, setTryInView] = useState(false);

  // Which section is under the middle of the screen (for the menu), and is the sample in view.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const middle = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    const any = new IntersectionObserver((entries) => {
      for (const e of entries) setTryInView(e.isIntersecting);
    });
    for (const id of SECTION_IDS) {
      const el = document.getElementById(id);
      if (el) middle.observe(el);
    }
    const sample = document.getElementById('try');
    if (sample) any.observe(sample);
    return () => {
      middle.disconnect();
      any.disconnect();
    };
  }, []);

  useEffect(() => {
    document.title = 'StayQuote · Group bookings. Quoted smarter.';
  }, []);

  // A thin bar at the top shows how far down the page you are.
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      bar.current?.style.setProperty('transform', `scaleX(${ratio})`);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return (
    <div className="lp-root min-h-screen">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2"
      >
        Skip to main content
      </a>
      <div aria-hidden="true" className="fixed inset-x-0 top-0 z-50 h-0.5 bg-transparent">
        <div ref={bar} className="lp-scroll-bar h-full bg-[var(--lp-ink)]" />
      </div>

      <header
        data-scrolled={y > 8}
        className="lp-header sticky top-0 z-40 border-b border-[var(--lp-line)] bg-white/90 backdrop-blur"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-10">
            <a
              href="#top"
              className="flex items-center gap-2.5"
              aria-label="StayQuote, top of page"
            >
              <LogoMark />
              <span className="text-xl font-semibold tracking-tight">StayQuote</span>
            </a>
            <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
              {NAV.map(([id, label]) => (
                <a
                  key={id}
                  href={`#${id}`}
                  onClick={(e) => jump(e, id)}
                  aria-current={NAV_FOR[active ?? ''] === id ? 'true' : undefined}
                  className="lp-navlink flex min-h-11 items-center rounded-full px-4 text-[0.95rem] font-medium hover:bg-[var(--lp-bg)]"
                >
                  {label}
                </a>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-[var(--lp-bg)] p-1.5">
            <SignInLink className="lp-btn-outline hidden min-h-11 text-[0.95rem] sm:inline-flex">
              Sign in
            </SignInLink>
            <a
              href="#try"
              onClick={(e) => jump(e, 'try')}
              className="lp-btn min-h-11 text-[0.95rem]"
            >
              Try a Group Quote
            </a>
          </div>
        </div>
      </header>

      <main id="content" tabIndex={-1} className="focus:outline-none">
        <span id="top" />
        <Hero />
        <Familiar />
        <Introducing />
        <HowItWorks />
        <Value />
        <Calculator />
        <Features />
        <HoldClock />
        <Audience />
        <Faq />

        <section aria-labelledby="cta-title" className="bg-white px-4 pb-20 pt-4 md:pb-28">
          <Reveal className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-[var(--lp-ink)] px-6 py-16 text-center text-white md:px-16 md:py-24">
            <div className="lp-rings" aria-hidden="true">
              <span />
              <span style={{ '--d': '2.3s' } as CSSProperties} />
              <span style={{ '--d': '4.6s' } as CSSProperties} />
            </div>
            <h2 id="cta-title" className="lp-h2 relative mx-auto max-w-3xl">
              The next group enquiry could be your next confirmed booking.
            </h2>
            <p className="relative mx-auto mt-5 max-w-2xl text-lg text-[#c9ccd2]">
              Don&apos;t let manual calculations slow down your response or leave you uncertain
              about the discount you can afford. Check the numbers. Evaluate the offer. Prepare your
              group quotation with confidence.
            </p>
            <SignInLink className="lp-btn-light lp-shine mt-9">
              Try Your First Group Quote <IconArrowRight className="size-5" />
            </SignInLink>
            <p className="relative mt-5 text-sm text-[#c9ccd2]">
              See how StayQuote can fit into your hotel&apos;s group booking process.
            </p>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-[var(--lp-line)] bg-white py-12">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 md:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <LogoMark className="size-8" />
              <span className="text-lg font-semibold tracking-tight">StayQuote</span>
            </div>
            <p className="mt-3 font-medium">Group bookings. Quoted smarter.</p>
            <p className="lp-muted mt-2 max-w-md text-sm">
              Helping independent hotels quote clearly, negotiate confidently and manage group
              booking enquiries more efficiently.
            </p>
          </div>
          <nav
            aria-label="Footer"
            className="flex flex-wrap content-start gap-x-8 gap-y-2 md:justify-end"
          >
            {FOOTER_LINKS.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                onClick={(e) => jump(e, id)}
                className="flex min-h-11 items-center text-sm font-medium hover:underline"
              >
                {label}
              </a>
            ))}
            <SignInLink className="flex min-h-11 items-center text-sm font-medium hover:underline">
              Sign in
            </SignInLink>
          </nav>
          <p className="lp-muted border-t border-[var(--lp-line)] pt-6 text-sm md:col-span-2">
            StayQuote is a case study built for Fynd × NMIMS Hyderabad (Case C32), a product and
            business simulation. All data is synthetic. Nothing here claims live revenue, market
            demand or production readiness.
          </p>
        </div>
      </footer>

      {y > 700 && !tryInView && (
        <a href="#try" onClick={(e) => jump(e, 'try')} className="lp-btn lp-fab lp-shine">
          Try a Group Quote <IconArrowRight className="size-5" />
        </a>
      )}
    </div>
  );
}

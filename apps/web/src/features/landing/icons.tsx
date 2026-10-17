import type { ReactNode } from 'react';

/** Small line icons. Decorative: they always sit next to a text label, so they are hidden from readers. */
function Svg({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ?? 'size-6'}
    >
      {children}
    </svg>
  );
}

type IconProps = { className?: string };

export const IconBed = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="M3 18V7" />
    <path d="M3 14h18v4" />
    <path d="M21 14v-2a3 3 0 0 0-3-3h-7v5" />
    <circle cx="7" cy="11" r="1.6" />
  </Svg>
);

export const IconCalendar = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M8 3v4M16 3v4M3 10h18" />
    <path d="m9 15 2 2 4-4" />
  </Svg>
);

export const IconScale = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="M12 3v18M7 21h10" />
    <path d="M5 7h14" />
    <path d="m5 7-3 7a3.5 3.5 0 0 0 6 0L5 7ZM19 7l-3 7a3.5 3.5 0 0 0 6 0l-3-7Z" />
  </Svg>
);

export const IconClock = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const IconShield = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="M12 3 4.5 6v5.5c0 4.5 3 8 7.5 9.5 4.5-1.5 7.5-5 7.5-9.5V6L12 3Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);

export const IconLock = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Svg>
);

export const IconUsers = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.4c2 .7 3.5 2.7 3.5 5.6" />
  </Svg>
);

export const IconList = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" />
  </Svg>
);

export const IconQuestion = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17v.01" />
  </Svg>
);

export const IconUpload = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Svg>
);

export const IconHistory = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
    <path d="M3.5 4v4.5H8M12 8v4.5l3 1.5" />
  </Svg>
);

export const IconCheck = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);

export const IconAlert = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="M12 4 2.5 20h19L12 4Z" />
    <path d="M12 10v4.5M12 17.5v.01" />
  </Svg>
);

export const IconArrowRight = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const IconSparkle = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="m6.3 6.3 2.4 2.4M15.3 15.3l2.4 2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4" />
  </Svg>
);

export const IconBolt = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />
  </Svg>
);

export const IconArrowUpRight = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Svg>
);

export const IconPlus = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconPercent = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="M19 5 5 19" />
    <circle cx="7" cy="7" r="2.4" />
    <circle cx="17" cy="17" r="2.4" />
  </Svg>
);

export const IconCalculator = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <rect x="5" y="3" width="14" height="18" rx="2.5" />
    <path d="M8.5 7.5h7M9 12v.01M12 12v.01M15 12v.01M9 16v.01M12 16v.01M15 16v.01" />
  </Svg>
);

export const IconFile = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="M6 3h8l4 4v14H6V3Z" />
    <path d="M14 3v4h4M9 12h6M9 16h6" />
  </Svg>
);

export const IconHotel = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 10h4a1 1 0 0 1 1 1v10M2.5 21h19" />
    <path d="M8 8h3M8 12h3M8 16h3" />
  </Svg>
);

export const IconTrend = ({ className }: IconProps) => (
  <Svg {...(className ? { className } : {})}>
    <path d="m3.5 17 6-6 4 4 7-8" />
    <path d="M15 7h5.5v5.5" />
  </Svg>
);

/** The product mark: a rounded tile with a Q, for quote. Black by default, like the wordmark. */
export function LogoMark({ className, fill = '#101319' }: IconProps & { fill?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className ?? 'size-9'}>
      <rect width="32" height="32" rx="9" fill={fill} />
      <circle cx="15.5" cy="15" r="7" fill="none" stroke="#fff" strokeWidth="3.4" />
      <path d="M19.6 19.4 24.5 24.2" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

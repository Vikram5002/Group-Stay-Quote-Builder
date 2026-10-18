import { useId } from 'react';
import { cn } from '../lib/cn';

/** The product mark: a bed under a roof, white on a black tile. */
export function Logo({ className }: { className?: string }) {
  const gradient = `c32-logo-${useId().replace(/:/g, '')}`;
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className={cn('size-10 shrink-0', className)}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a3a3a" />
          <stop offset="1" stopColor="#0e0e0e" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradient})`} />
      <path
        d="M7 15 16 8l9 7"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 24v-6h14v6M9 21h14M12 18v-1.5a1.5 1.5 0 0 1 1.5-1.5h1a1.5 1.5 0 0 1 1.5 1.5V18"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24.5" cy="7.5" r="2" fill="#ffcf4d" />
    </svg>
  );
}

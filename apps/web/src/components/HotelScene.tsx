import { useId } from 'react';
import { cn } from '../lib/cn';

/**
 * A hotel illustration (D-062) with no background of its own, so it sits on any surface: an
 * indigo tower drawn with a little depth, two lower wings, a gold canopy over a lit entrance, two
 * trees and a soft ground shadow. Windows light and dim one after another and a few gold sparkles
 * twinkle. It is decoration only (hidden from assistive technology), drawn as SVG so it is sharp
 * at any size, and the global reduced-motion rule stops it moving. Used on the sign-in page and
 * the dashboard banner.
 */

const ROWS = 7;
const COLS = 4;

/** A fixed, irregular pattern: which windows are lit, and when they change. */
function windowState(row: number, col: number) {
  const n = (row * 31 + col * 17 + row * col * 7) % 23;
  return { lit: n % 3 !== 0, delay: (n * 0.37) % 6, slow: n % 4 === 0 };
}

function Sparkle({ x, y, size, delay }: { x: number; y: number; size: number; delay: number }) {
  const s = size;
  return (
    <path
      d={`M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s}z`}
      fill="#f5b942"
      className="c32-star"
      style={{ animationDelay: `${delay}s` }}
    />
  );
}

export function HotelScene({
  className,
  sign = 'HOTEL',
}: {
  className?: string;
  /** The word on the rooftop sign. */
  sign?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const id = (name: string) => `c32-${name}-${uid}`;

  const towerX = 78;
  const towerW = 80;
  const top = 30;
  const ground = 188;
  const depth = 14;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 240 200"
      className={cn('c32-scene block overflow-visible', className)}
      preserveAspectRatio="xMidYMax meet"
    >
      <defs>
        <linearGradient id={id('front')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
        <linearGradient id={id('side')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3730a3" />
          <stop offset="1" stopColor="#272163" />
        </linearGradient>
        <linearGradient id={id('wing')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c7d2fe" />
          <stop offset="1" stopColor="#a5b4fc" />
        </linearGradient>
        <linearGradient id={id('glass')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe3a3" />
          <stop offset="1" stopColor="#f5b942" />
        </linearGradient>
        <radialGradient id={id('shadow')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#312e81" stopOpacity="0.22" />
          <stop offset="1" stopColor="#312e81" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Ground shadow */}
      <ellipse cx="120" cy={ground + 2} rx="112" ry="9" fill={`url(#${id('shadow')})`} />

      {/* Left wing */}
      <path d={`M30 96 l10 -6 h38 v6 z`} fill="#e0e7ff" />
      <rect x="30" y="96" width="48" height={ground - 96} fill={`url(#${id('wing')})`} />
      {[0, 1, 2, 3].map((r) =>
        [0, 1].map((c) => (
          <rect
            key={`l${r}${c}`}
            x={38 + c * 20}
            y={106 + r * 19}
            width="12"
            height="10"
            rx="2"
            fill={(r + c) % 2 ? '#ffffff' : `url(#${id('glass')})`}
            opacity={(r + c) % 2 ? 0.75 : 0.95}
          />
        )),
      )}

      {/* Right wing */}
      <rect x="172" y="118" width="42" height={ground - 118} rx="1" fill={`url(#${id('wing')})`} />
      <path d={`M172 118 l8 -5 h34 v5 z`} fill="#e0e7ff" />
      {[0, 1, 2].map((r) =>
        [0, 1].map((c) => (
          <rect
            key={`r${r}${c}`}
            x={180 + c * 17}
            y={128 + r * 18}
            width="10"
            height="10"
            rx="2"
            fill={(r * 3 + c) % 3 ? `url(#${id('glass')})` : '#ffffff'}
            opacity={(r * 3 + c) % 3 ? 0.95 : 0.75}
          />
        )),
      )}

      {/* Tower: top, side and front faces */}
      <path d={`M${towerX} ${top} l${depth} -8 h${towerW} l-${depth} 8 z`} fill="#a5b4fc" />
      <path
        d={`M${towerX + towerW} ${top} l${depth} -8 V${ground - 6} l-${depth} 6 z`}
        fill={`url(#${id('side')})`}
      />
      <rect x={towerX} y={top} width={towerW} height={ground - top} fill={`url(#${id('front')})`} />
      {/* A highlight down the leading edge */}
      <rect x={towerX} y={top} width="3" height={ground - top} fill="#818cf8" opacity="0.6" />

      {/* Rooftop sign */}
      <path d={`M104 ${top - 8} v-6 M132 ${top - 8} v-6`} stroke="#272163" strokeWidth="1.5" />
      <rect x="94" y="3" width="48" height="14" rx="7" fill="#1e1b4b" />
      <text
        x="118"
        y="12.6"
        textAnchor="middle"
        fontSize="7.5"
        fontWeight="700"
        letterSpacing="2.2"
        fill="#f5b942"
        className="c32-sign"
        fontFamily="Inter Variable, Inter, system-ui, sans-serif"
      >
        {sign}
      </text>

      {/* Tower windows, front */}
      {Array.from({ length: ROWS }, (_, row) =>
        Array.from({ length: COLS }, (_, col) => {
          const s = windowState(row, col);
          return (
            <rect
              key={`t${row}-${col}`}
              x={towerX + 9 + col * 17.5}
              y={top + 11 + row * 17.5}
              width="10"
              height="11"
              rx="2"
              fill={`url(#${id('glass')})`}
              className={s.lit ? (s.slow ? 'c32-win c32-win-slow' : 'c32-win') : 'c32-win-off'}
              style={{ animationDelay: `${s.delay}s` }}
            />
          );
        }),
      )}
      {/* Tower windows, side (in shade) */}
      {Array.from({ length: ROWS }, (_, row) => (
        <path
          key={`sw${row}`}
          d={`M${towerX + towerW + 4} ${top + 10 + row * 17.5} l6 -3.4 v11 l-6 3.4 z`}
          fill="#818cf8"
          opacity={row % 3 === 1 ? 0.75 : 0.35}
        />
      ))}

      {/* Entrance: gold canopy over a lit door */}
      <rect x="104" y={ground - 22} width="28" height="22" rx="2" fill="#1e1b4b" />
      <rect x="108" y={ground - 18} width="20" height="18" rx="1.5" fill={`url(#${id('glass')})`} />
      <rect x="117.4" y={ground - 18} width="1.2" height="18" fill="#1e1b4b" opacity="0.7" />
      <path d={`M98 ${ground - 22} h40 l-5 -7 h-30 z`} fill="#f5b942" />
      <rect x="98" y={ground - 22} width="40" height="2" fill="#d99a1e" />

      {/* Trees */}
      <rect x="15.8" y="170" width="2.4" height={ground - 170} rx="1" fill="#5b4636" />
      <circle cx="17" cy="164" r="11" fill="#10b981" />
      <circle cx="13.5" cy="160.5" r="4.5" fill="#34d399" />
      <rect x="223.8" y="174" width="2.2" height={ground - 174} rx="1" fill="#5b4636" />
      <circle cx="225" cy="169" r="8.5" fill="#10b981" />
      <circle cx="222.5" cy="166.5" r="3.5" fill="#34d399" />

      {/* Ground line */}
      <rect x="4" y={ground} width="232" height="1.5" rx="0.75" fill="#c7d2fe" />

      {/* Sparkles */}
      <Sparkle x={44} y={58} size={5} delay={0} />
      <Sparkle x={198} y={82} size={6} delay={1.1} />
      <Sparkle x={210} y={38} size={3.5} delay={2.2} />
      <Sparkle x={26} y={110} size={3} delay={0.6} />
    </svg>
  );
}

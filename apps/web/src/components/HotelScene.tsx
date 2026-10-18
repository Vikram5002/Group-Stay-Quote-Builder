import { useId } from 'react';
import { cn } from '../lib/cn';

/**
 * A hotel illustration (D-068) in the app's monochrome style, with no background of its own so it
 * sits on any surface: a black tower drawn with a little depth, two outlined white wings, a yellow
 * canopy over a lit entrance, two round trees and a soft ground shadow. Yellow is the only colour,
 * used for lit windows. Windows light and dim one after another and a few sparkles twinkle. It is
 * decoration only (hidden from assistive technology), drawn as SVG so it is sharp at any size, and
 * the global reduced-motion rule stops it moving. Used on the sign-in page and the dashboard banner.
 */

const INK = '#0e0e0e';
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
      fill={INK}
      className="c32-star"
      style={{ animationDelay: `${delay}s` }}
    />
  );
}

/** A lower wing: white with an ink outline, and a row of windows, some lit. */
function Wing({
  x,
  y,
  width,
  ground,
  rows,
  glass,
  seed,
}: {
  x: number;
  y: number;
  width: number;
  ground: number;
  rows: number;
  glass: string;
  seed: number;
}) {
  const gap = (width - 2 * 11) / 3;
  return (
    <g>
      <path
        d={`M${x} ${y} l8 -5 h${width - 8} v5 z`}
        fill="#f2f2f2"
        stroke={INK}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <rect
        x={x}
        y={y}
        width={width}
        height={ground - y}
        fill="#ffffff"
        stroke={INK}
        strokeWidth="1.4"
      />
      {Array.from({ length: rows }, (_, r) =>
        [0, 1].map((c) => (
          <rect
            key={`${r}${c}`}
            x={x + gap + c * (11 + gap)}
            y={y + 10 + r * 18}
            width="11"
            height="10"
            rx="2"
            fill={(r + c + seed) % 3 === 0 ? INK : `url(#${glass})`}
            stroke={INK}
            strokeWidth="1"
          />
        )),
      )}
    </g>
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
          <stop offset="0" stopColor="#2e2e2e" />
          <stop offset="1" stopColor={INK} />
        </linearGradient>
        <linearGradient id={id('glass')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#ffcf4d" />
        </linearGradient>
        <radialGradient id={id('shadow')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={INK} stopOpacity="0.16" />
          <stop offset="1" stopColor={INK} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Ground shadow */}
      <ellipse cx="120" cy={ground + 2} rx="112" ry="9" fill={`url(#${id('shadow')})`} />

      <Wing x={30} y={96} width={48} ground={ground} rows={4} glass={id('glass')} seed={1} />
      <Wing x={172} y={118} width={42} ground={ground} rows={3} glass={id('glass')} seed={0} />

      {/* Tower: top, side and front faces */}
      <path d={`M${towerX} ${top} l${depth} -8 h${towerW} l-${depth} 8 z`} fill="#4a4a4a" />
      <path
        d={`M${towerX + towerW} ${top} l${depth} -8 V${ground - 6} l-${depth} 6 z`}
        fill="#000000"
      />
      <rect x={towerX} y={top} width={towerW} height={ground - top} fill={`url(#${id('front')})`} />
      {/* A highlight down the leading edge */}
      <rect x={towerX} y={top} width="3" height={ground - top} fill="#5a5a5a" opacity="0.7" />

      {/* Rooftop sign */}
      <path d={`M104 ${top - 8} v-6 M132 ${top - 8} v-6`} stroke={INK} strokeWidth="1.5" />
      <rect x="94" y="3" width="48" height="14" rx="7" fill={INK} />
      <text
        x="118"
        y="12.6"
        textAnchor="middle"
        fontSize="7.5"
        fontWeight="700"
        letterSpacing="2.2"
        fill="#ffcf4d"
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
          fill="#5a5a5a"
          opacity={row % 3 === 1 ? 0.9 : 0.45}
        />
      ))}

      {/* Entrance: yellow canopy over a lit door */}
      <rect x="104" y={ground - 22} width="28" height="22" rx="2" fill="#000000" />
      <rect x="108" y={ground - 18} width="20" height="18" rx="1.5" fill={`url(#${id('glass')})`} />
      <rect x="117.4" y={ground - 18} width="1.2" height="18" fill={INK} opacity="0.7" />
      <path
        d={`M98 ${ground - 22} h40 l-5 -7 h-30 z`}
        fill="#ffcf4d"
        stroke={INK}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />

      {/* Trees */}
      <rect x="15.8" y="170" width="2.4" height={ground - 170} rx="1" fill={INK} />
      <circle cx="17" cy="164" r="11" fill={INK} />
      <circle cx="13.5" cy="160.5" r="4" fill="#4a4a4a" />
      <rect x="223.8" y="174" width="2.2" height={ground - 174} rx="1" fill={INK} />
      <circle cx="225" cy="169" r="8.5" fill={INK} />
      <circle cx="222.5" cy="166.5" r="3" fill="#4a4a4a" />

      {/* Ground line */}
      <rect x="4" y={ground} width="232" height="1.5" rx="0.75" fill={INK} />

      {/* Sparkles */}
      <Sparkle x={44} y={58} size={5} delay={0} />
      <Sparkle x={198} y={82} size={6} delay={1.1} />
      <Sparkle x={210} y={38} size={3.5} delay={2.2} />
      <Sparkle x={26} y={110} size={3} delay={0.6} />
    </svg>
  );
}

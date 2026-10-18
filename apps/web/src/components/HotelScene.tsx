import { cn } from '../lib/cn';

/**
 * A hotel at dusk (D-060): the facade's windows light up and dim one after another, a few stars
 * twinkle and the sign glows. It is decoration only (hidden from assistive technology), drawn as
 * SVG so it is sharp at any size and costs a few kilobytes, and the global reduced-motion rule
 * stops it moving. Used in the navigation rail, the sign-in page and the dashboard banner.
 */

const FLOORS = 6;
const COLS = 7;

/** A fixed, irregular pattern: which windows are lit, and when they change. */
function windowState(floor: number, col: number) {
  const n = (floor * 31 + col * 17 + floor * col * 7) % 23;
  return { lit: n % 3 !== 0, delay: (n * 0.37) % 6, slow: n % 4 === 0 };
}

export function HotelScene({
  className,
  sign = 'HOTEL',
}: {
  className?: string;
  /** The word on the rooftop sign. */
  sign?: string;
}) {
  const width = 240;
  const height = 200;
  const towerX = 60;
  const towerW = 120;
  const top = 48;
  const floorH = 20;
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      className={cn('c32-scene block', className)}
      preserveAspectRatio="xMidYMax meet"
    >
      <defs>
        <linearGradient id="c32-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f1d31" />
          <stop offset="1" stopColor="#24395a" />
        </linearGradient>
        <linearGradient id="c32-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6d38a" />
          <stop offset="1" stopColor="#d9a441" />
        </linearGradient>
      </defs>

      <rect width={width} height={height} rx="14" fill="url(#c32-sky)" />

      {/* Stars and moon */}
      {[
        [24, 22],
        [52, 36],
        [196, 18],
        [214, 44],
        [168, 30],
        [38, 60],
      ].map(([x, y], i) => (
        <circle
          key={`s${i}`}
          cx={x}
          cy={y}
          r={1.2}
          fill="#fff"
          className="c32-star"
          style={{ animationDelay: `${i * 0.7}s` }}
        />
      ))}
      <circle cx="200" cy="70" r="10" fill="#f3e3bf" opacity="0.9" />
      <circle cx="205" cy="66" r="9" fill="#1b2d48" />

      {/* Side wings */}
      <rect x="18" y="104" width="46" height="96" fill="#1a2b45" />
      <rect x="176" y="96" width="48" height="104" fill="#1a2b45" />
      {[0, 1, 2, 3].map((r) =>
        [0, 1].map((c) => (
          <rect
            key={`w${r}${c}`}
            x={26 + c * 18}
            y={114 + r * 20}
            width="10"
            height="12"
            rx="1.5"
            fill="url(#c32-glass)"
            opacity={(r + c) % 2 ? 0.25 : 0.85}
          />
        )),
      )}
      {[0, 1, 2, 3].map((r) =>
        [0, 1].map((c) => (
          <rect
            key={`e${r}${c}`}
            x={185 + c * 18}
            y={106 + r * 20}
            width="10"
            height="12"
            rx="1.5"
            fill="url(#c32-glass)"
            opacity={(r * 3 + c) % 3 ? 0.85 : 0.25}
          />
        )),
      )}

      {/* Tower */}
      <rect x={towerX} y={top} width={towerW} height={height - top} fill="#203653" />
      <rect x={towerX - 4} y={top - 6} width={towerW + 8} height="8" rx="2" fill="#2b4568" />
      <rect x={towerX + 30} y={top - 26} width="60" height="18" rx="3" fill="#15263d" />
      <text
        x={width / 2}
        y={top - 13}
        textAnchor="middle"
        fontSize="10"
        fontWeight="700"
        letterSpacing="3"
        fill="#d9a441"
        className="c32-sign"
        fontFamily="Inter Variable, Inter, system-ui, sans-serif"
      >
        {sign}
      </text>

      {Array.from({ length: FLOORS }, (_, floor) =>
        Array.from({ length: COLS }, (_, col) => {
          const s = windowState(floor, col);
          return (
            <rect
              key={`t${floor}-${col}`}
              x={towerX + 8 + col * 15.5}
              y={top + 10 + floor * floorH}
              width="10"
              height="13"
              rx="1.5"
              fill="url(#c32-glass)"
              className={s.lit ? (s.slow ? 'c32-win c32-win-slow' : 'c32-win') : 'c32-win-off'}
              style={{ animationDelay: `${s.delay}s` }}
            />
          );
        }),
      )}

      {/* Entrance with a gold canopy */}
      <rect x={width / 2 - 22} y={height - 30} width="44" height="30" fill="#132540" />
      <path d={`M${width / 2 - 30} ${height - 30} h60 l-6 -8 h-48 z`} fill="#d9a441" />
      <rect
        x={width / 2 - 14}
        y={height - 24}
        width="28"
        height="24"
        fill="url(#c32-glass)"
        opacity="0.9"
      />
      <rect x={width / 2 - 0.75} y={height - 24} width="1.5" height="24" fill="#132540" />
    </svg>
  );
}

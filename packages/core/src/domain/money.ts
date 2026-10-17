/**
 * Integer money helpers (blueprint 5.3, decision G14). All money is whole INR held in JS numbers
 * well inside the safe-integer range, so every operation here is exact.
 */

/** Throw unless `value` is a safe integer within [min, max]. Guards the engine's inputs. */
export function assertInt(
  name: string,
  value: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}], got ${value}`);
  }
}

/** Exact ceiling of a / b for integers, b > 0. Works for negative a. */
export function ceilDiv(a: number, b: number): number {
  assertInt('dividend', a, Number.MIN_SAFE_INTEGER);
  assertInt('divisor', b, 1);
  let q = Math.floor(a / b);
  // Correct any floating-point drift so the result is exact.
  while (q * b < a) q += 1;
  while ((q - 1) * b >= a) q -= 1;
  return q;
}

/**
 * Percentage of `part` over `whole` on a 0 to 100 scale, rounded half away from zero to one
 * decimal place. Display only: rules never compare percentages. Null when whole is not positive.
 */
export function percentOneDecimal(part: number, whole: number): number | null {
  assertInt('part', part, Number.MIN_SAFE_INTEGER);
  assertInt('whole', whole, Number.MIN_SAFE_INTEGER);
  if (whole <= 0) return null;
  const sign = part < 0 ? -1 : 1;
  const scaled = Math.abs(part) * 1000; // tenths of a percent, times whole
  let tenths = Math.floor(scaled / whole);
  const remainder = scaled - tenths * whole;
  if (remainder * 2 >= whole) tenths += 1;
  return (sign * tenths) / 10;
}

/** Sum that propagates unknown: any null makes the result null (null means unknown, never zero). */
export function sumKnown(values: readonly (number | null)[]): number | null {
  let total = 0;
  for (const v of values) {
    if (v === null) return null;
    total += v;
  }
  return total;
}

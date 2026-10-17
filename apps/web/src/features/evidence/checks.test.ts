import { verifyDerivedClaims } from './checks';
import { LEDGER } from './ledger';

describe('derived ledger claims', () => {
  it('recomputes E01 and E02 from the fixture and they match', () => {
    const checks = verifyDerivedClaims();
    expect(checks.map((c) => c.id)).toEqual(['E01', 'E02']);
    expect(checks.every((c) => c.matches)).toBe(true);
    expect(checks[0]?.recomputed).toBe('Revenue 40000, contribution 24000');
    expect(checks[1]?.recomputed).toBe('Minimum safe rate 2000');
  });

  it('only offers recomputation for claims tagged Derived', () => {
    const derived = LEDGER.filter((e) => e.type === 'Derived').map((e) => e.id);
    expect(verifyDerivedClaims().every((c) => derived.includes(c.id))).toBe(true);
  });
});

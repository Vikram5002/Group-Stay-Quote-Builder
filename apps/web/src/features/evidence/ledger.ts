/**
 * The evidence ledger (blueprint 16.8). Every business claim carries a type and a source so a
 * reviewer can see what is measured, what is arithmetic and what is only assumed.
 *
 * These rows are the blueprint's starting ledger. Track 4 owns evidence/ledger.csv; this screen
 * reads the same columns, so replacing the rows with that file changes no screen code.
 */
export type ClaimType =
  'Observed' | 'Derived' | 'Assumption' | 'Not yet measured' | 'Observed after experiment';

export interface LedgerEntry {
  id: string;
  claim: string;
  type: ClaimType;
  source: string;
  confidence: string;
  nextTest: string;
}

export const LEDGER: readonly LedgerEntry[] = [
  {
    id: 'E01',
    claim: '10 x 2 x 2000 = 40000 revenue; contribution 24000.',
    type: 'Derived',
    source: 'fixture.json; test T01',
    confidence: 'High (arithmetic only)',
    nextTest: 'n/a',
  },
  {
    id: 'E02',
    claim: 'Minimum safe rate on the fixture is 1800 (full price 2000 less the 10% Sales limit).',
    type: 'Derived',
    source: 'Formula; test T03, T18',
    confidence: 'High (arithmetic only)',
    nextTest: 'n/a',
  },
  {
    id: 'E03',
    claim: 'Small hotels quote groups manually and slowly.',
    type: 'Assumption',
    source: 'Case brief',
    confidence: 'Unknown',
    nextTest: 'Shadow desk (H1)',
  },
  {
    id: 'E04',
    claim: 'Owners will pay per property per month.',
    type: 'Assumption',
    source: 'README hypothesis',
    confidence: 'Unknown',
    nextTest: 'Price probes (H4)',
  },
  {
    id: 'E05',
    claim: 'Expiry reduces stale-price disputes.',
    type: 'Assumption',
    source: 'Team reasoning',
    confidence: 'Unknown',
    nextTest: 'Owner interviews (H5)',
  },
  {
    id: 'E06',
    claim: 'AWS cost per quote.',
    type: 'Not yet measured',
    source: 'CloudWatch and Cost Explorer',
    confidence: 'n/a',
    nextTest: 'Measure week 8',
  },
  {
    id: 'E07',
    claim: 'Organiser response behaviour.',
    type: 'Observed after experiment',
    source: 'Experiment log',
    confidence: 'Process evidence only',
    nextTest: 'Repeat with real organisers',
  },
];

export const CLAIM_TYPES: readonly ClaimType[] = [
  'Observed',
  'Derived',
  'Assumption',
  'Not yet measured',
  'Observed after experiment',
];

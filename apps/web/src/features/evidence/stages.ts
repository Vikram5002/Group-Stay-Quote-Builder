/**
 * The three saved stages the case requires (blueprint 3.3): starting state, negotiated scope
 * and final evidence. The descriptions come from the blueprint. Whether a stage's files exist
 * is Track 4's to say, so each stage starts as "awaiting" until it is marked provided.
 */
export interface EvidenceStage {
  id: 'baseline' | 'scope' | 'final';
  title: string;
  tag: string;
  path: string;
  summary: string;
  artifacts: readonly string[];
  /** Set to true when the files are committed under evidence/. */
  provided: boolean;
}

export const STAGES: readonly EvidenceStage[] = [
  {
    id: 'baseline',
    title: 'Baseline v0',
    tag: 'baseline-v0',
    path: 'evidence/00-baseline',
    summary: 'The minimal quote builder that only calculates revenue and contribution.',
    artifacts: ['Screenshots', 'A JSON sample', 'Written limitations'],
    provided: false,
  },
  {
    id: 'scope',
    title: 'Negotiated scope',
    tag: 'scope-negotiated',
    path: 'evidence/01-negotiated-scope.md',
    summary:
      'The product change requested (room-night availability and quote expiry), what the customer agreed, what was deferred, and the acceptance criteria.',
    artifacts: ['One-page scope record'],
    provided: false,
  },
  {
    id: 'final',
    title: 'Final evidence v1',
    tag: 'final-v1',
    path: 'evidence/02-final',
    summary: 'The finished product, tested, with saved results and an honest ledger.',
    artifacts: [
      'Test report',
      'Saved quote results (JSON)',
      'CSV exports',
      'Deployment proof',
      'Pilot simulation log',
      'Evidence ledger',
    ],
    provided: false,
  },
];

export type Coverage = 'yes' | 'no' | 'agreed';

export interface DeltaRow {
  capability: string;
  baseline: Coverage;
  scope: Coverage;
  final: Coverage;
}

/**
 * What each stage covers. Baseline has no availability and no expiry (blueprint 3.3), the
 * negotiated change adds them, and the final stage is where they are shown working.
 */
export const DELTA: readonly DeltaRow[] = [
  { capability: 'Revenue and contribution', baseline: 'yes', scope: 'yes', final: 'yes' },
  { capability: 'Room-night availability', baseline: 'no', scope: 'agreed', final: 'yes' },
  { capability: 'Quote expiry', baseline: 'no', scope: 'agreed', final: 'yes' },
];

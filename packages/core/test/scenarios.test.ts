import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  Evaluation,
  evaluate,
  mapC32Fixture,
  validateQuoteRequest,
  type InventoryNight,
  type Policy,
  type RatePlanNight,
} from '../src/index.js';
import { readJson, repoPath } from './helpers.js';

/**
 * Track 4 acceptance scenarios (T4.04, handoff C2): business situations with expected outputs in
 * data/fixtures/scenarios/*.json, run through the real engine. Add a file to add a scenario.
 */

interface Scenario {
  id: string;
  title: string;
  source: string;
  policy: Partial<Policy>;
  request: unknown;
  inventory?: InventoryNight[];
  rate_plan?: RatePlanNight[];
  now: string;
  expect: Record<string, unknown>;
}

const fx = mapC32Fixture(readJson('data/fixtures/fixture.json'));
const dir = 'data/fixtures/scenarios';
const files = readdirSync(repoPath(dir))
  .filter((f) => f.endsWith('.json'))
  .sort();
const scenarios = files.map((f) => readJson(`${dir}/${f}`) as Scenario);

describe('Track 4 acceptance scenarios', () => {
  it('there are at least ten, with unique ids', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(10);
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
  });

  it.each(scenarios.map((s) => [`${s.id} ${s.title} (${s.source})`, s] as const))(
    '%s',
    (_name, s) => {
      const v = validateQuoteRequest(s.request);
      if (!v.ok) throw new Error(`${s.id}: invalid request ${JSON.stringify(v.problem.errors)}`);
      const { evaluation } = evaluate(v.value, {
        inventory: s.inventory ?? fx.inventory,
        ratePlan: s.rate_plan ?? fx.ratePlan,
        policy: { ...fx.policy, ...s.policy },
        nowMs: Date.parse(s.now),
      });
      expect(Evaluation.safeParse(evaluation).success).toBe(true);
      expect(evaluation).toMatchObject(s.expect);
    },
  );
});

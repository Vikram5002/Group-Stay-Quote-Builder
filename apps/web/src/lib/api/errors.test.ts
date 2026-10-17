import { ERROR_CODES } from '@c32/core';
import { describeError } from './errors';

describe('error messages', () => {
  it.each(ERROR_CODES)('%s has a plain-language message and next step', (code) => {
    const friendly = describeError(code);
    expect(friendly.title.length).toBeGreaterThan(0);
    expect(friendly.message.length).toBeGreaterThan(0);
    expect(friendly.nextStep.length).toBeGreaterThan(0);
  });

  it('offers Re-quote when a quote expired or rooms were taken', () => {
    expect(describeError('QUOTE_EXPIRED').action).toBe('re-quote');
    expect(describeError('HOLD_CONFLICT').action).toBe('re-quote');
  });

  it('never shows internal detail for server errors', () => {
    expect(describeError('INTERNAL').message).not.toMatch(/stack|exception|lambda/i);
  });
});

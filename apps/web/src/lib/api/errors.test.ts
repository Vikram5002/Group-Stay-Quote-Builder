import { ERROR_CODES, problem } from '@c32/core';
import { ApiError, describeError, problemText } from './errors';

describe('problemText: what to tell the person when an action fails', () => {
  it("uses the server's problem+json detail", () => {
    const error = new ApiError(
      problem('INVALID_STATE', { detail: 'An extension can be at most 24 hours' }),
    );
    expect(problemText(error)).toBe('An extension can be at most 24 hours');
  });

  it('falls back to the title when there is no detail', () => {
    expect(problemText(new ApiError(problem('QUOTE_EXPIRED')))).toBe('Quote has expired');
  });

  it('never shows the text of an unexpected error', () => {
    expect(problemText(new Error('TypeError: x is undefined'))).toBe(
      'Something went wrong. Try again.',
    );
  });
});

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

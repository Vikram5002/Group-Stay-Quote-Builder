import { DEFAULT_POLICY } from '@c32/core';
import { afterEach, describe, expect, it } from 'vitest';
import { savePolicy } from '../../src/data/policy.js';
import { getEvents, getQuote } from '../../src/data/quotes.js';
import { buildMime, MemoryEmailSender } from '../../src/email/sender.js';
import { cancelQuote } from '../../src/services/changes.js';
import { confirmQuote } from '../../src/services/confirm-quote.js';
import { createQuote } from '../../src/services/create-quote.js';
import { emailDocument, recordPayment } from '../../src/services/documents.js';
import { ServiceError } from '../../src/services/errors.js';
import { hasDb } from '../data/local-db.js';
import { owner, request, sales, serviceHarness } from './harness.js';

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof ServiceError ? e.code : String(e)),
  );

const withEmail = (over: object = {}) =>
  request({ organiser: { name: 'Fictional Events', email: 'events@example.com' }, ...over });

describe.skipIf(!hasDb)('quote and invoice emails (DynamoDB Local, D-059)', () => {
  let drop: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await drop?.();
    drop = undefined;
  });
  async function setup() {
    const h = await serviceHarness();
    drop = h.drop;
    const email = new MemoryEmailSender();
    await savePolicy(h.ctx, { ...DEFAULT_POLICY, hotel_name: 'Hotel Sagar Residency', version: 0 });
    return { ...h, email, deps: { ...h.deps, email } };
  }

  it('emails the quote PDF to the organiser and records it', async () => {
    const h = await setup();
    const q = await createQuote(h.deps, withEmail(), sales);
    const sent = await emailDocument(h.deps, q.quote_id, sales, 'quote', null);

    expect(h.email.sent).toHaveLength(1);
    const mail = h.email.sent[0]!;
    expect(mail.to).toBe('events@example.com');
    expect(mail.subject).toMatch(/^Quote Q-\w{10} from Hotel Sagar Residency$/);
    expect(mail.text).toContain('total INR 40,000');
    expect(mail.attachment.filename).toMatch(/^Q-\w{10}\.pdf$/);
    expect(Buffer.from(mail.attachment.content).subarray(0, 5).toString()).toBe('%PDF-');

    expect(sent.emails).toEqual([
      expect.objectContaining({ kind: 'quote', to: 'events@example.com', message_id: 'memory-1' }),
    ]);
    expect(await getQuote(h.ctx, q.quote_id)).toEqual(sent);
    expect((await getEvents(h.ctx, q.quote_id)).at(-1)).toMatchObject({
      type: 'EMAILED',
      after: { kind: 'quote', to: 'events@example.com' },
    });
  });

  it('an override address is used for that one send', async () => {
    const h = await setup();
    const q = await createQuote(h.deps, withEmail(), sales);
    await emailDocument(h.deps, q.quote_id, sales, 'quote', 'boss@example.com');
    expect(h.email.sent[0]?.to).toBe('boss@example.com');
  });

  it('invoice only after payment is recorded, once, on a confirmed booking', async () => {
    const h = await setup();
    const q = await createQuote(h.deps, withEmail(), sales);
    expect(await codeOf(recordPayment(h.deps, q.quote_id, owner, null))).toBe('INVALID_STATE');
    await confirmQuote(h.deps, q.quote_id, sales);
    expect(await codeOf(emailDocument(h.deps, q.quote_id, sales, 'invoice', null))).toBe(
      'INVALID_STATE',
    );

    const paid = await recordPayment(h.deps, q.quote_id, owner, 'UPI 4321');
    expect(paid.payment).toMatchObject({ reference: 'UPI 4321', recorded_by: owner });
    expect(await codeOf(recordPayment(h.deps, q.quote_id, owner, null))).toBe('INVALID_STATE');

    const after = await emailDocument(h.deps, q.quote_id, sales, 'invoice', null);
    expect(h.email.sent[0]?.subject).toMatch(/^Invoice INV-\w{10} from Hotel Sagar Residency$/);
    expect(after.emails?.map((e) => e.kind)).toEqual(['invoice']);
    expect((await getEvents(h.ctx, q.quote_id)).map((e) => e.type)).toEqual([
      'QUOTE_CREATED',
      'CONFIRMED',
      'PAYMENT_RECORDED',
      'EMAILED',
    ]);
  });

  it('refuses closed quotes, a missing address, and a missing email setup', async () => {
    const h = await setup();
    const q = await createQuote(h.deps, withEmail(), sales);
    await cancelQuote(h.deps, q.quote_id, sales, null);
    expect(await codeOf(emailDocument(h.deps, q.quote_id, sales, 'quote', null))).toBe(
      'INVALID_STATE',
    );

    const noAddress = await createQuote(h.deps, request(), sales);
    expect(await codeOf(emailDocument(h.deps, noAddress.quote_id, sales, 'quote', null))).toBe(
      'INVALID_STATE',
    );
    const { email: _e, ...noEmail } = h.deps;
    expect(
      await codeOf(emailDocument(noEmail, noAddress.quote_id, sales, 'quote', 'x@example.com')),
    ).toBe('INVALID_STATE');
    expect(h.email.sent).toEqual([]);
  });
});

describe('MIME message', () => {
  it('has a text body and a base64 PDF attachment, with an encoded non-ASCII subject', () => {
    const mime = buildMime('quotes@example.com', {
      to: 'events@example.com',
      subject: 'Quote from Hôtel',
      text: 'Hello',
      attachment: { filename: 'Q-1.pdf', content: new TextEncoder().encode('%PDF-1.7 test') },
    });
    expect(mime).toContain('From: quotes@example.com');
    expect(mime).toContain('Subject: =?UTF-8?B?');
    expect(mime).toContain('Content-Type: application/pdf; name="Q-1.pdf"');
    expect(mime).toContain(Buffer.from('%PDF-1.7 test').toString('base64'));
  });
});

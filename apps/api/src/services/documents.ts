import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Actor, Quote, QuoteEvent, QuoteStatus } from '@c32/core';
import { getQuote, putEventTx, replaceQuoteTx } from '../data/quotes.js';
import { documentNumber, inr, renderDocument, type DocumentKind } from '../documents/pdf.js';
import type { ServiceDeps } from './create-quote.js';
import { ServiceError } from './errors.js';
import { loadPolicy } from './inputs.js';

/**
 * Quote and invoice documents (D-059). Sales or the Owner email the quote PDF; once the
 * organiser has paid, either records the payment, and only then can the invoice be emailed.
 * Every send and every payment is a version-checked write with its own audit event.
 */

/** A quote can be sent while it is on offer or booked; never when it is closed or in review. */
const QUOTE_SENDABLE: ReadonlySet<QuoteStatus> = new Set(['OFFERED', 'CONFIRMED']);

async function load(deps: ServiceDeps, quoteId: string): Promise<Quote> {
  const quote = await getQuote(deps.data, quoteId);
  if (!quote) throw new ServiceError('NOT_FOUND', `Quote ${quoteId} not found`);
  return quote;
}

/** Save `next` and its audit event together, or fail if the quote changed meanwhile. */
async function commit(deps: ServiceDeps, before: Quote, next: Quote, event: QuoteEvent) {
  try {
    await deps.data.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          replaceQuoteTx(deps.data, next, before.version, before.status),
          putEventTx(deps.data, event),
        ],
      }),
    );
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      throw new ServiceError('VERSION_CONFLICT', 'The quote changed meanwhile; reload and retry');
    }
    throw err;
  }
}

export async function recordPayment(
  deps: ServiceDeps,
  quoteId: string,
  actor: Actor,
  reference: string | null,
): Promise<Quote> {
  const quote = await load(deps, quoteId);
  if (quote.status !== 'CONFIRMED') {
    throw new ServiceError('INVALID_STATE', 'Payment can only be recorded on a confirmed booking');
  }
  if (quote.payment) throw new ServiceError('INVALID_STATE', 'Payment is already recorded');
  const at = new Date(deps.clock.now()).toISOString();
  const payment = { received_at: at, recorded_by: actor, reference };
  const next: Quote = { ...quote, payment, version: quote.version + 1, updated_at: at };
  await commit(deps, quote, next, {
    event_id: deps.newId(),
    quote_id: quoteId,
    type: 'PAYMENT_RECORDED',
    actor,
    at,
    before: { payment: null },
    after: { payment: { reference } },
    reason: null,
  });
  return next;
}

export async function emailDocument(
  deps: ServiceDeps,
  quoteId: string,
  actor: Actor,
  kind: DocumentKind,
  to: string | null,
): Promise<Quote> {
  const quote = await load(deps, quoteId);
  if (kind === 'quote' && !QUOTE_SENDABLE.has(quote.status)) {
    throw new ServiceError('INVALID_STATE', `A ${quote.status} quote cannot be emailed`);
  }
  if (kind === 'invoice' && !quote.payment) {
    throw new ServiceError('INVALID_STATE', 'Record the payment before emailing the invoice');
  }
  const recipient = to ?? quote.request.organiser.email ?? null;
  if (!recipient) {
    throw new ServiceError(
      'INVALID_STATE',
      'The organiser has no email address; enter one to send',
    );
  }
  if (!deps.email) throw new ServiceError('INVALID_STATE', 'Email is not set up here');

  const policy = await loadPolicy(deps.data);
  const nowMs = deps.clock.now();
  const pdf = await renderDocument({ kind, quote, policy, nowMs });
  const number = documentNumber(kind, quote);
  const t = quote.evaluation.totals;
  const total =
    t.room_revenue_inr === null || t.inclusions_revenue_inr === null
      ? null
      : t.room_revenue_inr + t.inclusions_revenue_inr;
  const title = kind === 'quote' ? 'Quote' : 'Invoice';
  const messageId = await deps.email.send({
    to: recipient,
    subject: `${title} ${number} from ${policy.hotel_name}`,
    text: [
      `Dear ${quote.request.organiser.name},`,
      '',
      kind === 'quote'
        ? `Please find attached our quote ${number} for your group stay, total ${inr(total)}.`
        : `Thank you for your payment. Please find attached invoice ${number}, total ${inr(total)}.`,
      kind === 'quote' && quote.valid_until
        ? `The rooms are held until ${quote.valid_until} (UTC); confirm before then to keep them.`
        : '',
      '',
      `Regards,`,
      policy.hotel_name,
    ]
      .filter((line, i, all) => line !== '' || all[i - 1] !== '')
      .join('\n'),
    attachment: { filename: `${number}.pdf`, content: pdf },
  });

  const at = new Date(nowMs).toISOString();
  const sent = { kind, to: recipient, sent_at: at, sent_by: actor, message_id: messageId };
  const next: Quote = {
    ...quote,
    emails: [...(quote.emails ?? []), sent],
    version: quote.version + 1,
    updated_at: at,
  };
  await commit(deps, quote, next, {
    event_id: deps.newId(),
    quote_id: quoteId,
    type: 'EMAILED',
    actor,
    at,
    before: null,
    after: { kind, to: recipient, number },
    reason: null,
  });
  return next;
}

import { randomUUID } from 'node:crypto';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { FileStore } from '../files/store.js';

/**
 * Outgoing email with one PDF attachment (D-059). SES in AWS; locally the message is written to
 * the local file store as an .eml file (open it in any mail app); in tests it is kept in memory.
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  attachment: { filename: string; content: Uint8Array };
}

export interface EmailSender {
  /** Sends the message; returns the provider's message id. */
  send(email: OutgoingEmail): Promise<string>;
}

/** The provider refused the message, for example an unverified recipient in the SES sandbox. */
export class EmailNotSentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailNotSentError';
  }
}

/** Encode a header value that may hold non-ASCII text (RFC 2047). */
const header = (value: string) =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;

/** base64 wrapped at 76 characters, as MIME requires. */
const wrapped = (data: Uint8Array | string) =>
  (
    Buffer.from(data)
      .toString('base64')
      .match(/.{1,76}/g) ?? []
  ).join('\r\n');

/** A multipart/mixed MIME message: a plain-text body and the PDF. */
export function buildMime(from: string, email: OutgoingEmail): string {
  const boundary = `c32-${randomUUID()}`;
  return [
    `From: ${from}`,
    `To: ${email.to}`,
    `Subject: ${header(email.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapped(email.text),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${email.attachment.filename}"`,
    `Content-Disposition: attachment; filename="${email.attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    wrapped(email.attachment.content),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export class SesEmailSender implements EmailSender {
  constructor(
    private readonly client: SESv2Client,
    private readonly from: string,
  ) {}

  async send(email: OutgoingEmail): Promise<string> {
    try {
      const out = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: this.from,
          Destination: { ToAddresses: [email.to] },
          Content: { Raw: { Data: Buffer.from(buildMime(this.from, email)) } },
        }),
      );
      return out.MessageId ?? 'unknown';
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'MessageRejected' || name === 'MailFromDomainNotVerifiedException') {
        throw new EmailNotSentError(
          `The email was not sent: ${(err as Error).message}. In the SES sandbox the recipient must be a verified address.`,
        );
      }
      throw err;
    }
  }
}

/** Local development: write the message as an .eml file instead of sending it. */
export class LocalEmailSender implements EmailSender {
  constructor(
    private readonly files: FileStore,
    private readonly from: string,
  ) {}

  async send(email: OutgoingEmail): Promise<string> {
    const id = randomUUID();
    await this.files.put(`outbox/${id}.eml`, buildMime(this.from, email), 'message/rfc822');
    return `local-${id}`;
  }
}

/** Tests: keep every message. */
export class MemoryEmailSender implements EmailSender {
  readonly sent: OutgoingEmail[] = [];
  async send(email: OutgoingEmail): Promise<string> {
    this.sent.push(email);
    return `memory-${this.sent.length}`;
  }
}

/** SES when SENDER_EMAIL is set (Track 3 sets it on the Lambda), else none. */
export function sesSenderFromEnv(env: NodeJS.ProcessEnv = process.env): EmailSender | undefined {
  const from = env['SENDER_EMAIL'];
  if (!from) return undefined;
  return new SesEmailSender(new SESv2Client({ region: env['AWS_REGION'] ?? 'ap-south-1' }), from);
}

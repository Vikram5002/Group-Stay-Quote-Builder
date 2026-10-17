/** A fresh key per user intent. Reuse the same key when retrying the same action. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

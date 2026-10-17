import { z } from 'zod';

export const HealthResponse = z.strictObject({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  contract_version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

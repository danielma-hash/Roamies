import {z} from 'zod';
export const asmRecordSchema=z.strictObject({
  id:z.string().min(8).max(240).refine(value=>value.startsWith('memory:')),
  scope:z.enum(['company','personal']),project:z.string().min(1).max(100).optional(),
  offset:z.number().int().min(0).max(131_072).optional(),
  expectedDigest:z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

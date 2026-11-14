import { z } from 'zod';
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const taskBudgetReasonSchema = z.enum(['time', 'tools', 'screenshots', 'tokens', 'no_progress']);
export const taskBudgetSnapshotSchema = z.object({
  limits: z.object({ tools: count.positive(), screenshots: count, tokens: count.positive(), durationMs: count.positive(), repeatedReads: count.positive() }),
  tools: count, screenshots: count, inputTokens: count, outputTokens: count, cacheRead: count, cacheWrite: count,
  usageReported: z.boolean(), usageIncomplete: z.boolean(), elapsedMs: z.number().finite().nonnegative(),
  stoppedReason: taskBudgetReasonSchema.optional(),
});

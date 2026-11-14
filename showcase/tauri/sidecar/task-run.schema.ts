import { z } from 'zod';
import { taskBudgetSnapshotSchema } from './task-budget.schema.js';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const taskRunSchema = z.object({
  id: z.string().uuid(), conversationId: z.string().max(200).optional(), request: z.string().max(12_000), hasImage: z.boolean(),
  status: z.enum(['queued', 'running', 'returned', 'failed', 'interrupted']), verified: z.literal(false),
  createdAt: z.number().finite().nonnegative(), updatedAt: z.number().finite().nonnegative(),
  archivedAt: z.number().finite().nonnegative().optional(),
  budget: taskBudgetSnapshotSchema.optional(),
  tools: z.array(z.object({
    id: z.string().min(1).max(200), name: z.string().min(1).max(100), argsDigest: digest,
    status: z.enum(['pending', 'returned', 'error', 'unknown']), resultDigest: digest.optional(),
  })).max(200),
});
export const taskRunArchiveSchema = z.object({ version: z.literal(1), runs: z.array(taskRunSchema).max(200) }).superRefine((archive, context) => {
  const archived=archive.runs.filter(run=>run.archivedAt!==undefined);
  if(archived.length>100||archive.runs.length-archived.length>100||archived.some(run=>['running','queued'].includes(run.status)))context.addIssue({code:'custom',message:'Invalid task archive state'});
  if (new Set(archive.runs.map((run) => run.id)).size !== archive.runs.length || archive.runs.some((run) => new Set(run.tools.map((tool) => tool.id)).size !== run.tools.length)) {
    context.addIssue({ code: 'custom', message: 'Duplicate task or tool identity' });
  }
});

import type { z } from 'zod';
import type { taskBudgetReasonSchema, taskBudgetSnapshotSchema } from './task-budget.schema.js';
export type TaskBudgetSnapshot = z.infer<typeof taskBudgetSnapshotSchema>;
export type TaskBudgetLimits = Readonly<TaskBudgetSnapshot['limits']>;
export type TaskBudgetReason = z.infer<typeof taskBudgetReasonSchema>;
export interface TaskReportedUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

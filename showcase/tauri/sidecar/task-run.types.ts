import type { z } from 'zod';
import type { taskRunSchema, taskRunArchiveSchema } from './task-run.schema.js';
export type TaskRun = z.infer<typeof taskRunSchema>;
export type TaskRunArchive = z.infer<typeof taskRunArchiveSchema>;

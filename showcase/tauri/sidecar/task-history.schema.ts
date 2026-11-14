import {z} from 'zod';
export const taskHistoryFilterSchema=z.strictObject({archived:z.boolean().optional(),query:z.string().max(200).optional(),page:z.number().int().min(1).max(10).optional()});
export const taskArchiveInputSchema=z.strictObject({id:z.uuid(),expectedUpdatedAt:z.number().int().nonnegative(),archived:z.boolean()});
export const taskHistoryMessageSchema=z.discriminatedUnion('action',[
  z.strictObject({type:z.literal('task_history'),action:z.literal('list'),requestId:z.uuid(),filter:taskHistoryFilterSchema}),
  z.strictObject({type:z.literal('task_history'),action:z.literal('archive'),requestId:z.uuid(),filter:taskHistoryFilterSchema,input:taskArchiveInputSchema}),
]);
export const taskHistorySnapshotSchema=z.strictObject({
  actions:z.boolean(),archived:z.boolean(),query:z.string().max(200),page:z.number().int().min(1).max(10),total:z.number().int().min(0).max(100),observedAt:z.number(),
  rows:z.array(z.strictObject({id:z.uuid(),request:z.string().max(400),status:z.enum(['queued','running','returned','failed','interrupted']),updatedAt:z.number(),archived:z.boolean(),uncertain:z.number().int().nonnegative(),tools:z.number().int().nonnegative()})).max(20),
});

import {z} from 'zod';
const cell=z.union([z.string().max(1000),z.number().finite(),z.boolean(),z.null()]);
export const artifactSchema=z.strictObject({
  format:z.enum(['html','csv']),title:z.string().trim().min(1).max(200),
  text:z.string().max(20_000).optional(),
  table:z.strictObject({columns:z.array(z.string().min(1).max(100)).min(1).max(12),rows:z.array(z.array(cell).max(12)).max(200)}).optional(),
  sources:z.array(z.strictObject({title:z.string().min(1).max(200),url:z.string().max(2000),accessedAt:z.string().max(40).optional()})).max(20).optional(),
});

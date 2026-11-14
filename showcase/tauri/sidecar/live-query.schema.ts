import {z} from 'zod';
export const liveQuerySourceSchema=z.enum(['sessions','prs','attention']);
export const liveQueryTableSchema=z.strictObject({columns:z.array(z.string().max(120)).min(1).max(5),rows:z.array(z.array(z.string().max(200)).max(5)).max(10),rowIds:z.array(z.string().max(1000)).max(10),observedAt:z.number().finite().nonnegative(),source:z.string().max(200)}).superRefine((table,ctx)=>{
 if(table.rows.some(row=>row.length!==table.columns.length)||table.rows.length!==table.rowIds.length||new TextEncoder().encode(JSON.stringify(table)).length>24000)ctx.addIssue({code:'custom',message:'נתוני המסך חורגים מהחוזה.'});
});
export const liveQueryMessageSchema=z.strictObject({kind:z.literal('live_query'),panelId:z.uuid(),revision:z.number().int().positive(),blockId:z.string().max(40),status:z.enum(['loading','ready','stale','error','paused']),table:liveQueryTableSchema.optional(),error:z.string().max(300).optional()});

import type {z} from 'zod';
import type {liveQueryMessageSchema,liveQueryTableSchema,liveQuerySourceSchema} from './live-query.schema.js';
export type LiveQuerySource=z.infer<typeof liveQuerySourceSchema>;
export type LiveQueryTable=z.infer<typeof liveQueryTableSchema>;
export type LiveQueryMessage=z.infer<typeof liveQueryMessageSchema>;
export type LiveQueryReader=(source:LiveQuerySource,query:string,signal:AbortSignal)=>Promise<LiveQueryTable>;

export type LiveQueryBlock=Extract<import('./live-panel.types.js').LiveBlock,{kind:'query'}>;

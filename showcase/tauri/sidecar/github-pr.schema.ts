import {z} from 'zod';
import {githubShaSchema} from './github-read.schema.js';
// Keep control-character validation local: this regex in the provider's strict
// JSON Schema caused ChatGPT to return empty max_output_tokens responses.
const branch=z.string().min(1).max(200).refine(value=>/^[^\s\0-\x1f]+$/.test(value));
export const githubPrPrepareSchema=z.strictObject({cwd:z.string().min(1).max(2000),repo:z.string().regex(/^[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/).refine(value=>!['.','..'].includes(value.split('/')[1]!)),remote:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,60}$/),head:branch,base:branch,expectedHead:githubShaSchema,expectedBase:githubShaSchema,title:z.string().min(1).max(200),body:z.string().min(1).max(12_000)});
export const githubPrCreateSchema=z.strictObject({previewId:z.uuid()});
export const githubPrIntentSchema=z.strictObject({key:z.string().regex(/^[a-f0-9]{64}$/),requestDigest:z.string().regex(/^[a-f0-9]{64}$/),state:z.enum(['pending','unknown','created']),createdAt:z.iso.datetime(),url:z.string().max(500).optional()});
export const githubPrJournalSchema=z.strictObject({version:z.literal(1),intents:z.array(githubPrIntentSchema).max(200)});

import type {z} from 'zod';
import type {githubReadSchema,githubPinnedSchema,githubPatchSchema} from './github-read.schema.js';
export type GitHubReadInput=z.input<typeof githubReadSchema>;
export type GitHubPinnedInput=z.input<typeof githubPinnedSchema>;
export type GitHubPatchInput=z.input<typeof githubPatchSchema>;
export type GitHubGet=(endpoint:string,signal?:AbortSignal)=>Promise<unknown>;

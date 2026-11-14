import type {z} from 'zod';
import type {githubPrPrepareSchema,githubPrIntentSchema} from './github-pr.schema.js';
import type {FactoryInspect} from './factory-policy.types.js';
export type GitHubPrInput=z.infer<typeof githubPrPrepareSchema>;
export type GitHubPrIntent=z.infer<typeof githubPrIntentSchema>;
export type GitHubPrCommand=(binary:string,args:readonly string[],options:{readonly cwd?:string;readonly input?:string;readonly signal?:AbortSignal})=>Promise<string>;
export interface GitHubPrOptions {
 readonly allowed:()=>boolean;
 readonly confirm:(text:string,signal?:AbortSignal)=>Promise<boolean>;
 readonly policy:FactoryInspect;
 readonly command?:GitHubPrCommand;
}

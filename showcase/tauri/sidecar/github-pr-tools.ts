import type {ToolContext} from '@kenkaiiii/gg-agent';
import type {GitHubPrService} from './github-pr.service.js';
import {githubPrPrepareSchema,githubPrCreateSchema} from './github-pr.schema.js';
export function createGitHubPrTools(service:GitHubPrService){
 return [
  {name:'github_pr_prepare',description:'Prepare an exact draft-PR preview for a clean committed worktree, existing pushed branch and exact remote head/base SHA. Read-only preparation does not create or push anything. The target repo must match the selected remote. Checks installed factory governance; governed or unverifiable projects are blocked from this generic route and require factory pr. No merge, deploy or cross-repository fork creation.',parameters:githubPrPrepareSchema,timeoutMs:90_000,executionMode:'sequential' as const,execute:async(input:unknown,ctx?:ToolContext)=>JSON.stringify(await service.prepare(input,ctx?.signal))},
  {name:'github_pr_create',description:'Use a prepared previewId to request exact human approval and create a draft PR. Actions setting must be enabled; rechecks branch, SHA and policy after approval. Durable pending intent prevents a duplicate POST after timeout/restart. Existing PRs are only observed, never edited; verify the receipt. Unknown outcomes require reconciliation, not automatic retry. Never merges or deploys.',parameters:githubPrCreateSchema,timeoutMs:240_000,executionMode:'sequential' as const,execute:async(input:unknown,ctx?:ToolContext)=>JSON.stringify(await service.create(input,ctx?.signal))},
 ] as const;
}

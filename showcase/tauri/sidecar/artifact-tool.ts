import {artifactSchema} from './artifact.schema.js';
import type {ArtifactService} from './artifact.service.js';
import type {ToolContext} from '@kenkaiiii/gg-agent';
export function createArtifactTool(service:ArtifactService){
  return {name:'artifact_export',description:'Save a bounded Hebrew RTL HTML report or CSV table in the dedicated Roamies Exports folder. Provide actual sources, never invent citations. HTML supports text/table/sources; CSV supports a table with optional sources column, no separate text. Treat provided data as text, no code. Actions must be enabled. Identical content reuses the verified file without overwrite. Receipt verifies file bytes only, not factual correctness. Use open with returned path when the user wants to view it.',parameters:artifactSchema,executionMode:'sequential' as const,execute:async(input:unknown,context?:ToolContext)=>JSON.stringify(await service.create(input,context?.signal))};
}

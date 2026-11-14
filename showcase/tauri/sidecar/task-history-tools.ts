import type {ToolContext} from '@kenkaiiii/gg-agent';
import type {TaskHistoryService} from './task-history.service.js';
import {taskHistoryFilterSchema,taskArchiveInputSchema} from './task-history.schema.js';
export function createTaskHistoryTools(service:TaskHistoryService){return [
  {name:'task_history_list',description:'Read up to 20 local Jarvis tasks per page, including uncertain outcomes. archived=true reads the reversible archive. Returned means a model response, not verified completion. Exact IDs and updatedAt are required to archive/restore; never infer identity from list position.',parameters:taskHistoryFilterSchema,execute:async(input:unknown)=>JSON.stringify(await service.list(input))},
  {name:'task_history_archive',description:'Move an inactive local Jarvis task to the archive or restore it to the main list on explicit user request. Use exact id and expectedUpdatedAt from task_history_list. This only changes visibility, preserves unknown outcomes, never resumes/replays work and never deletes history. Actions setting required.',parameters:taskArchiveInputSchema,executionMode:'sequential' as const,execute:async(input:unknown,context?:ToolContext)=>JSON.stringify(await service.archive(input,context?.signal))},
];}

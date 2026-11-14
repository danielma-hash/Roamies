import type {TaskRunService} from './task-run.service.js';
import {TaskRunError} from './task-run-error.js';
import {taskHistoryFilterSchema,taskArchiveInputSchema,taskHistoryMessageSchema} from './task-history.schema.js';
export class TaskHistoryService {
  constructor(private readonly tasks:TaskRunService,private readonly allowed:()=>boolean){}
  async list(raw:unknown={}){
    const {archived=false,query='',page=1}=taskHistoryFilterSchema.parse(raw);
    await this.tasks.initialize();await this.tasks.flush();
    const matches=this.tasks.list(true).filter(run=>(run.archivedAt!==undefined)===archived&&run.request.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b)=>b.updatedAt-a.updatedAt);
    return {actions:this.allowed(),archived,query,page,total:matches.length,observedAt:Date.now(),rows:matches.slice((page-1)*20,page*20).map(run=>({id:run.id,request:run.request.slice(0,400),status:run.status,updatedAt:run.updatedAt,archived:run.archivedAt!==undefined,uncertain:run.tools.filter(tool=>['pending','unknown','error'].includes(tool.status)).length,tools:run.tools.length}))};
  }
  async archive(raw:unknown,signal?:AbortSignal){
    const input=taskArchiveInputSchema.parse(raw);signal?.throwIfAborted();
    await this.tasks.initialize();await this.tasks.flush();signal?.throwIfAborted();
    const guard=()=>{signal?.throwIfAborted();if(!this.allowed())throw new TaskRunError('יש להפעיל פעולות כדי לשנות את הארכיון.');};
    const run=await this.tasks.setArchived(input.id,input.expectedUpdatedAt,input.archived,guard);
    return {id:run.id,archived:run.archivedAt!==undefined,status:run.status,updatedAt:run.updatedAt,verified:run.verified,note:'רק מיקום המשימה בהיסטוריה השתנה. לא הופעלה משימה ולא שונתה תוצאה לא ידועה.'};
  }
  async handle(raw:unknown){
    const message=taskHistoryMessageSchema.parse(raw);
    try{if(message.action==='archive')await this.archive(message.input);return {kind:'task_history',requestId:message.requestId,snapshot:await this.list(message.filter)};}
    catch(error){return {kind:'task_history',requestId:message.requestId,error:error instanceof TaskRunError?error.message:'לא ניתן לטעון את יומן המשימות.'};}
  }
}

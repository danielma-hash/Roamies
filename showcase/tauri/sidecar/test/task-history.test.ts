import {afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {TaskRunService} from '../task-run.service.js';
import {TaskRunStoreService} from '../task-run-store.service.js';
import {TaskHistoryService} from '../task-history.service.js';
import {taskRunArchiveSchema} from '../task-run.schema.js';
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(){const root=await mkdtemp('/tmp/roamies-task-history-');roots.push(root);const store=new TaskRunStoreService(join(root,'runs.json')),tasks=new TaskRunService(store);let allowed=true;return {store,tasks,history:new TaskHistoryService(tasks,()=>allowed),deny:()=>{allowed=false;}};}
async function interrupted(tasks:TaskRunService){const task=await tasks.create('משימת בדיקה');await tasks.start(task.id);await tasks.beginTool(task.id,'call','fixture_write',{target:'fixture'});await tasks.finish(task.id,'interrupted');return tasks.get(task.id);}
it('archives and restores after restart without replaying tools or changing uncertain outcomes',async()=>{
 const f=await fixture(),run=await interrupted(f.tasks);const input={id:run.id,expectedUpdatedAt:run.updatedAt,archived:true};
 const result=await f.history.archive(input);expect(result).toMatchObject({archived:true,status:'interrupted',verified:false});expect(f.tasks.list()).toHaveLength(0);
 expect(await f.history.archive(input)).toMatchObject({archived:true,updatedAt:result.updatedAt});
 const restarted=new TaskRunService(f.store);await restarted.initialize();const service=new TaskHistoryService(restarted,()=>true);
 expect((await service.list({archived:true})).rows[0]).toMatchObject({id:run.id,uncertain:1});
 await service.archive({id:run.id,expectedUpdatedAt:result.updatedAt,archived:false});expect(restarted.get(run.id)).toMatchObject({status:'interrupted',verified:false,tools:[{status:'unknown'}]});
 expect(restarted.list()).toHaveLength(1);await expect(restarted.start(run.id)).rejects.toThrow('אוטומטית');
});
it('frees one slot in a full uncertain journal using the native path without creating an agent task',async()=>{
 const f=await fixture();const sample=await interrupted(f.tasks);const runs=Array.from({length:100},()=>({...sample,id:randomUUID()}));await f.store.save({version:1,runs});
 const tasks=new TaskRunService(f.store),history=new TaskHistoryService(tasks,()=>true);await tasks.initialize();await expect(tasks.create('blocked')).rejects.toThrow('מלא');
 const reply=await history.handle({type:'task_history',action:'archive',requestId:randomUUID(),filter:{},input:{id:runs[0]!.id,expectedUpdatedAt:runs[0]!.updatedAt,archived:true}});
 expect(reply).toHaveProperty('snapshot.total',99);await tasks.create('בקשה חדשה');expect(tasks.list()).toHaveLength(100);expect(tasks.list(true)).toHaveLength(101);expect(tasks.get(runs[0]!.id).tools[0]?.status).toBe('unknown');
 await expect(history.archive({id:runs[0]!.id,expectedUpdatedAt:tasks.get(runs[0]!.id).updatedAt,archived:false})).rejects.toThrow('מלאה');
});
it('rejects active tasks, stale versions, disabled actions and cancellation',async()=>{
 const f=await fixture(),queued=await f.tasks.create('פעילה');await expect(f.history.archive({id:queued.id,expectedUpdatedAt:queued.updatedAt,archived:true})).rejects.toThrow('פעילה');
 const run=await interrupted(f.tasks);await expect(f.history.archive({id:run.id,expectedUpdatedAt:run.updatedAt-1,archived:true})).rejects.toThrow('השתנתה');
 const abort=new AbortController();abort.abort();await expect(f.history.archive({id:run.id,expectedUpdatedAt:run.updatedAt,archived:true},abort.signal)).rejects.toThrow();
 f.deny();await expect(f.history.archive({id:run.id,expectedUpdatedAt:run.updatedAt,archived:true})).rejects.toThrow('פעולות');expect((await f.history.list({})).actions).toBe(false);
});
it('rejects unauthorized queued changes and failed storage without optimistic archive state',async()=>{
 const f=await fixture(),run=await interrupted(f.tasks);let allow=true;
 await expect(f.tasks.setArchived(run.id,run.updatedAt,true,()=>{if(!allow)throw new Error('revoked');}) .then(value=>{expect(value.archivedAt).toBeDefined();})).resolves.toBeUndefined();
 const archived=f.tasks.get(run.id);allow=false;await expect(f.tasks.setArchived(run.id,archived.updatedAt,false,()=>{if(!allow)throw new Error('revoked');})).rejects.toThrow('revoked');
 vi.spyOn(f.store,'save').mockRejectedValue(new Error('disk full'));await expect(f.history.archive({id:run.id,expectedUpdatedAt:archived.updatedAt,archived:false})).rejects.toThrow();expect(f.tasks.get(run.id).archivedAt).toBeDefined();
});
it('bounds archive size and validates legacy and malformed persisted states',async()=>{
 const f=await fixture(),sample=await interrupted(f.tasks);expect(taskRunArchiveSchema.safeParse({version:1,runs:[sample]}).success).toBe(true);
 expect(taskRunArchiveSchema.safeParse({version:1,runs:[{...sample,status:'running',archivedAt:1}]}).success).toBe(false);
 const archived=Array.from({length:100},()=>({...sample,id:randomUUID(),archivedAt:1}));await f.store.save({version:1,runs:[sample,...archived]});
 const service=new TaskHistoryService(new TaskRunService(f.store),()=>true);await expect(service.archive({id:sample.id,expectedUpdatedAt:sample.updatedAt,archived:true})).rejects.toThrow('מלא');
 const page=await service.list({archived:true,page:2});expect(page.rows).toHaveLength(20);expect(page.total).toBe(100);await expect(service.list({page:11})).rejects.toThrow();
});

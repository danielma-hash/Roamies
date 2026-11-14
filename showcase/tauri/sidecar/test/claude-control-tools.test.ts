import { expect, it, vi } from 'vitest';
import { ClaudeRunService } from '../claude-run.service.js';
import { ClaudeSessionsService } from '../claude-sessions.service.js';
import { createClaudeControlTools } from '../claude-control-tools.js';
const id='12345678-1234-4567-8901-123456789abc';
const snapshot={id,cwd:'/tmp/test-project',title:'בדיקת קולות',state:'idle' as const,queued:0,lastReply:''};
function setup() {
 const runs=new ClaudeRunService({executable:()=>'/claude',allowActions:()=>true,confirm:async()=>false,query:()=>{throw Error('must not run');},activeSessionIds:async()=>[]});
 const start=vi.spyOn(runs,'start').mockResolvedValue(snapshot);
 const send=vi.spyOn(runs,'send').mockResolvedValue({...snapshot,state:'running'});
 const stop=vi.spyOn(runs,'stop').mockReturnValue({...snapshot,state:'stopped'});
 vi.spyOn(runs,'list').mockReturnValue([snapshot]);
 let allowed=true,readOnly=false;
 const confirm=vi.fn(async()=>true);
 const tools=createClaudeControlTools({runs,sessions:new ClaudeSessionsService(),allowActions:()=>allowed,readOnly:()=>readOnly,confirm});
 const tool=(name:string)=>tools.find(t=>t.name===`claude_control_${name}`)!;
 return {tool,start,send,stop,confirm,disable:()=>{allowed=false;},readOnly:()=>{readOnly=true;}};
}
it('routes start, follow-up and resume to the exact managed session; receipts do not claim completion',async()=>{
 const h=setup();
 const result=JSON.parse(await h.tool('start').execute({cwd:snapshot.cwd,title:'חדש',instruction:'בדוק את הטסטים'}));
 expect(result).toMatchObject({accepted:true,completed:false}); expect(h.start).toHaveBeenCalledWith(snapshot.cwd,'חדש','בדוק את הטסטים',undefined,undefined);
 await h.tool('resume').execute({id,instruction:'המשך'}); expect(h.send).toHaveBeenCalledWith(id,'המשך');
 expect(h.start).toHaveBeenCalledTimes(1);
 await h.tool('send').execute({id,instruction:'סכם'});expect(h.confirm).toHaveBeenLastCalledWith(expect.stringContaining('סכם'));
});
it('supports emergency stop with actions disabled, without waiting behind permission dialogs',async()=>{
 const h=setup();h.disable(); await h.tool('stop').execute({id});expect(h.stop).toHaveBeenCalledWith(id);expect(h.confirm).not.toHaveBeenCalled();
 h.readOnly();await expect(h.tool('stop').execute({id})).rejects.toThrow('קריאה בלבד');
});
it('rejects unknown targets, invalid args, denial, revoked permissions and aborted approval',async()=>{
 const h=setup(); await expect(h.tool('send').execute({id:'bad',instruction:'go'})).rejects.toThrow();
 h.confirm.mockResolvedValueOnce(false); expect(JSON.parse(await h.tool('send').execute({id,instruction:'go'}))).toEqual({cancelled:true});expect(h.send).not.toHaveBeenCalled();
 h.confirm.mockImplementationOnce(async()=>{h.disable();return true;}); await expect(h.tool('send').execute({id,instruction:'go'})).rejects.toThrow('בוטלה');expect(h.send).not.toHaveBeenCalled();
 const aborted=setup();let approve:((value:boolean)=>void)|undefined;
 aborted.confirm.mockImplementation(()=>new Promise(r=>{approve=r;}));
 const controller=new AbortController();const pending=aborted.tool('start').execute({cwd:snapshot.cwd,instruction:'go'},{signal:controller.signal,toolCallId:'test'});
 await vi.waitFor(()=>expect(aborted.confirm).toHaveBeenCalled());controller.abort(new Error('cancelled'));
 await expect(pending).rejects.toThrow('cancelled');approve?.(true);await Promise.resolve();expect(aborted.start).not.toHaveBeenCalled();
});

// @ts-expect-error Existing production safety module is JavaScript.
import { redactArgs } from '../safety.mjs';
it('keeps dictated instructions out of diagnostic tool-argument logs', () => {
 expect(redactArgs('claude_control_send', { id, instruction: 'private instruction' })).toEqual({ id, instruction: '[19 chars]' });
});

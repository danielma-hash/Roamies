import { expect, it, vi } from 'vitest';
import { BrowserControlsService } from '../browser-controls.service.js';
const jobId='d25b7ba2-b00e-49db-93ae-133b743601d5';
function fixture(){
 let enabled=true,now=1000;const confirm=vi.fn(async()=>true);const apply=vi.fn(async()=>({status:'delivered',verified:true}));
 const target={frameId:'frame',loaderId:'loader',frameUrl:'https://example.com/',backendNodeId:1,role:'textbox',name:'שם',signature:'identity',value:'',href:'',actions:['fill']};
 const inspect=vi.fn(async()=>({source:'https://example.com/',controls:[target],truncated:false,framesSkipped:0}));const read=vi.fn(async()=>({text:'observed'}));
 const service=new BrowserControlsService({inspect,apply,read,confirm,allowActions:()=>enabled,now:()=>now});
 return {service,inspect,apply,confirm,read,target,disable:()=>{enabled=false;},expire:()=>{now+=60_000;}};
}
it('requires exact approval and forwards the observed target identity',async()=>{
 const f=fixture();const page=await f.service.inspect(jobId);const ref=page.controls[0].ref;
 expect(await f.service.act({ref,action:'fill',text:'Jarvis בעברית'})).toMatchObject({delivery:'delivered',verified:true,verification:'field_value',page:{text:'observed'}});
 expect(f.confirm).toHaveBeenCalledWith(expect.stringContaining('Jarvis בעברית'),undefined);
 expect(f.apply).toHaveBeenCalledWith(expect.objectContaining({jobId,frameId:'frame',loaderId:'loader',backendNodeId:1,signature:'identity',text:'Jarvis בעברית'}),undefined);
 await expect(f.service.act({ref,action:'fill',text:'again'})).rejects.toThrow('ההפניה');expect(f.apply).toHaveBeenCalledTimes(1);
});
it('blocks disabled actions and rechecks after approval',async()=>{
 const f=fixture();const page=await f.service.inspect(jobId);f.disable();
 await expect(f.service.act({ref:page.controls[0].ref,action:'fill',text:'test'})).rejects.toThrow('כבויות');expect(f.confirm).not.toHaveBeenCalled();
 const g=fixture();const fresh=await g.service.inspect(jobId);g.confirm.mockImplementation(async()=>{g.disable();return true;});
 await expect(g.service.act({ref:fresh.controls[0].ref,action:'fill',text:'test'})).rejects.toThrow('ההרשאה');expect(g.apply).not.toHaveBeenCalled();
});
it('consumes cancelled, expired and unknown-result refs without retries',async()=>{
 const f=fixture();let page=await f.service.inspect(jobId);f.confirm.mockResolvedValueOnce(false);
 expect(await f.service.act({ref:page.controls[0].ref,action:'fill',text:'test'})).toEqual({cancelled:true});expect(f.apply).not.toHaveBeenCalled();
 page=await f.service.inspect(jobId);f.expire();await expect(f.service.act({ref:page.controls[0].ref,action:'fill',text:'test'})).rejects.toThrow('ההפניה');
 page=await f.service.inspect(jobId);f.apply.mockRejectedValueOnce(new Error('timeout'));
 expect(await f.service.act({ref:page.controls[0].ref,action:'fill',text:'test'})).toMatchObject({delivery:'unknown',verified:false,readBeforeRetry:true});
 expect(f.apply).toHaveBeenCalledTimes(1);
});
it('reports rejected stale documents and does not call read or retry',async()=>{
 const f=fixture();const page=await f.service.inspect(jobId);f.apply.mockResolvedValueOnce({status:'rejected',verified:false});
 expect(await f.service.act({ref:page.controls[0].ref,action:'fill',text:'test'})).toMatchObject({delivery:'not_delivered',verified:false});expect(f.read).not.toHaveBeenCalled();
});
it('does not claim verification when read-back fails',async()=>{
 const f=fixture();const page=await f.service.inspect(jobId);f.read.mockRejectedValueOnce(new Error('offline'));
 expect(await f.service.act({ref:page.controls[0].ref,action:'fill',text:'test'})).toMatchObject({delivery:'delivered',verified:false,readBeforeRetry:true});
});
it('invalidates older observations and refuses concurrent operations while approval is pending',async()=>{
 const f=fixture();const old=await f.service.inspect(jobId),page=await f.service.inspect(jobId);
 await expect(f.service.act({ref:old.controls[0].ref,action:'fill',text:'test'})).rejects.toThrow('ההפניה');
 let release!:(value:boolean)=>void;f.confirm.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const action=f.service.act({ref:page.controls[0].ref,action:'fill',text:'test'});
 await expect(f.service.inspect(jobId)).rejects.toThrow('ממתינה');release(false);await action;
});
it('rejects local sources and filters non-HTTPS link actions',async()=>{
 const f=fixture();f.target.href='javascript:alert(1)';expect((await f.service.inspect(jobId)).controls).toEqual([]);
 f.inspect.mockResolvedValueOnce({source:'https://127.0.0.1/',controls:[],truncated:false,framesSkipped:0});await expect(f.service.inspect(jobId)).rejects.toThrow('המקור');
});

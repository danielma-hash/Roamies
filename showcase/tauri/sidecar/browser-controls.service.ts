import { randomUUID } from 'node:crypto';
import { z } from 'zod';
// @ts-expect-error Existing app safety module.
import { checkBrowserAction, checkUrl, SAFE, BLOCK } from './safety.mjs';
import type { BrowserControl, BrowserControlsOptions } from './browser-controls.types.js';

const controlSchema = z.object({ frameId:z.string().min(1).max(100),loaderId:z.string().min(1).max(100),frameUrl:z.string().max(8000),backendNodeId:z.number().int().positive(),role:z.string().max(40),name:z.string().max(160),signature:z.string().max(12000),value:z.string().max(2000),href:z.string().max(8000),actions:z.array(z.enum(['click','fill'])).min(1).max(2) });
const snapshotSchema = z.object({source:z.string().max(8000),controls:z.array(controlSchema).max(30),truncated:z.boolean(),framesSkipped:z.number().int().min(0)});
interface Binding { readonly jobId:string; readonly source:string; readonly time:number; readonly target:z.infer<typeof controlSchema>; }
export class BrowserControlsError extends Error { override readonly name = 'BrowserControlsError'; }
export class BrowserControlsService {
  private readonly bindings = new Map<string, Binding>();
  private readonly busy = new Set<string>();
  private readonly now: () => number;
  constructor(private readonly options: BrowserControlsOptions) { this.now=options.now??Date.now; }
  private invalidate(jobId:string):void { for(const [ref,binding] of this.bindings)if(binding.jobId===jobId)this.bindings.delete(ref); }
  async inspect(jobId:string,signal?:AbortSignal) {
    z.uuid().parse(jobId);signal?.throwIfAborted();
    if(this.busy.has(jobId))throw new BrowserControlsError('פעולה כבר ממתינה או מתבצעת במשימה הזאת.');
    this.busy.add(jobId);this.invalidate(jobId);
    try {
      const snapshot=snapshotSchema.parse(await this.options.inspect(jobId,signal));
      if(checkUrl(snapshot.source).level!==SAFE||!snapshot.source.startsWith('https://'))throw new BrowserControlsError('המקור אינו אתר ציבורי מורשה.');
      for(const [ref,binding] of this.bindings)if(this.now()-binding.time>=60_000)this.bindings.delete(ref);
      while(this.bindings.size+snapshot.controls.length>60){
        const oldest=this.bindings.values().next().value;if(!oldest)break;this.invalidate(oldest.jobId);
      }
      const controls:BrowserControl[]=[];
      for(const target of snapshot.controls){
        if(target.href&&(checkUrl(target.href).level!==SAFE||!target.href.startsWith('https://')))continue;
        if(this.bindings.size>=60)break;
        const ref=randomUUID();this.bindings.set(ref,{jobId,source:snapshot.source,time:this.now(),target});
        controls.push({ref,role:target.role,name:target.name,value:target.value,actions:target.actions});
      }
      return {jobId,source:snapshot.source,controls,truncated:snapshot.truncated||controls.length<snapshot.controls.length,framesSkipped:snapshot.framesSkipped,expiresAt:new Date(this.now()+60_000).toISOString(),untrustedContent:true};
    } finally {this.busy.delete(jobId);}
  }
  async act(input:{ref:string;action:'click'|'fill';text?:string},signal?:AbortSignal) {
    const value=z.object({ref:z.uuid(),action:z.enum(['click','fill']),text:z.string().max(2000).optional()}).parse(input);
    signal?.throwIfAborted();const binding=this.bindings.get(value.ref);
    if(!binding||this.now()-binding.time>=60_000)throw new BrowserControlsError('ההפניה אינה תקפה. יש לקרוא שוב את רכיבי הדף.');
    if(this.busy.has(binding.jobId))throw new BrowserControlsError('פעולה כבר ממתינה או מתבצעת במשימה הזאת.');
    if(!binding.target.actions.includes(value.action))throw new BrowserControlsError('הפעולה אינה נתמכת ברכיב.');
    const policy=()=>checkBrowserAction(binding.source,value.action,{allowActions:this.options.allowActions(),text:value.text});
    const verdict=policy();if(verdict.level===BLOCK)throw new BrowserControlsError(verdict.reason);
    this.busy.add(binding.jobId);this.invalidate(binding.jobId);
    try {
      const question=`${value.action==='fill'?'למלא את השדה':'ללחוץ על'} ״${binding.target.name||binding.target.role}״?\nמקור: ${binding.source}${value.action==='fill'?`\nטקסט: ${value.text}`:''}`;
      if(!await this.options.confirm(question,signal))return {cancelled:true};
      signal?.throwIfAborted();if(policy().level===BLOCK||this.now()-binding.time>=60_000)throw new BrowserControlsError('ההרשאה או התצפית פגו. יש לקרוא את הדף מחדש.');
      let result: {status:'rejected'|'delivered';verified?:boolean;verification?:string;reason?:string};
      try {
        result=z.object({status:z.enum(['rejected','delivered']),verified:z.boolean().optional(),verification:z.string().optional(),reason:z.string().optional()}).parse(await this.options.apply({...binding.target,jobId:binding.jobId,source:binding.source,action:value.action,...(value.text!==undefined?{text:value.text}:{})},signal));
      } catch {
        return {delivery:'unknown',verified:false,readBeforeRetry:true,error:'אין ראיה מספקת אם הפעולה נמסרה. המשימה נעצרה אם החיבור נכשל; אין לחזור על הפעולה אוטומטית.'};
      }
      if(result.status==='rejected')return {delivery:'not_delivered',verified:false,readBeforeRetry:true,reason:result.reason};
      try {return {delivery:'delivered',verified:value.action==='fill'&&result.verified===true,verification:value.action==='fill'?'field_value':undefined,page:await this.options.read(binding.jobId,signal)};}
      catch{return {delivery:'delivered',verified:false,readBeforeRetry:true,error:'הפעולה נמסרה אך קריאת התוצאה נכשלה. אין לחזור עליה אוטומטית.'};}
    } finally {this.busy.delete(binding.jobId);}
  }
}

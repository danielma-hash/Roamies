import {liveQueryTableSchema} from './live-query.schema.js';
import type {LivePanelEnvelope} from './live-panel.types.js';
import type {LiveQueryReader,LiveQueryMessage,LiveQueryTable,LiveQuerySource,LiveQueryBlock} from './live-query.types.js';
/** Fixed read-only sources; visibility and permission are checked again after every await. */
export class LiveQueryService {
 private generation=0;
 private signature='';
 private active=false;
 private readonly timers=new Set<ReturnType<typeof setTimeout>>();
 private readonly controllers=new Set<AbortController>();
 private readonly nextAllowed=new Map<LiveQuerySource,number>();
 private readonly cache=new Map<string,LiveQueryTable>();
 constructor(private readonly read:LiveQueryReader,private readonly publish:(message:LiveQueryMessage)=>void,private readonly allowed:()=>boolean){}
 activate(panel:LivePanelEnvelope|undefined,visible:boolean):void{
  const active=visible&&this.allowed();const signature=panel?`${panel.id}:${panel.revision}`:'';
  if(this.signature===signature&&this.active===active)return;
  this.stop();this.signature=signature;this.active=active;
  if(!panel)return;
  for(const block of panel.spec.blocks){if(block.kind!=='query')continue;
   if(!active){this.publish({kind:'live_query',panelId:panel.id,revision:panel.revision,blockId:block.id,status:'paused'});continue;}
   this.schedule(panel,block,this.generation);
  }
 }
 close():void{this.stop();this.signature='';this.active=false;}
 private stop():void{this.generation++;for(const timer of this.timers)clearTimeout(timer);this.timers.clear();for(const controller of this.controllers)controller.abort();this.controllers.clear();}
 private schedule(panel:LivePanelEnvelope,block:LiveQueryBlock,generation:number):void{
  if(generation!==this.generation||!this.active||!this.allowed())return;
  const key=JSON.stringify([block.source,block.query??'']);const cached=this.cache.get(key);
  const publish=(status:LiveQueryMessage['status'],table?:LiveQueryTable,error?:string)=>this.publish({kind:'live_query',panelId:panel.id,revision:panel.revision,blockId:block.id,status,table,error});
  const delay=Math.max(0,(this.nextAllowed.get(block.source)??0)-Date.now());
  publish(cached?(Date.now()-cached.observedAt>90_000?'stale':'ready'):'loading',cached);
  const timer=setTimeout(()=>{this.timers.delete(timer);void this.refresh(panel,block,key,generation);},delay);timer.unref();this.timers.add(timer);
 }
 private async refresh(panel:LivePanelEnvelope,block:LiveQueryBlock,key:string,generation:number):Promise<void>{
  if(generation!==this.generation||!this.active||!this.allowed())return;
  this.nextAllowed.set(block.source,Date.now()+(block.source==='prs'?60_000:30_000));
  const controller=new AbortController();this.controllers.add(controller);
  let timeout:ReturnType<typeof setTimeout>|undefined;let abort:(()=>void)|undefined;
  try{
   const deadline=new Promise<never>((_resolve,reject)=>{abort=()=>reject(new Error('cancelled'));controller.signal.addEventListener('abort',abort,{once:true});timeout=setTimeout(()=>controller.abort(),22_000);timeout.unref();});
   const table=liveQueryTableSchema.parse(await Promise.race([this.read(block.source,block.query??'',controller.signal),deadline]));
   if(generation!==this.generation||!this.active||!this.allowed())return;
   this.cache.delete(key);this.cache.set(key,table);if(this.cache.size>30)this.cache.delete(this.cache.keys().next().value!);
   this.publish({kind:'live_query',panelId:panel.id,revision:panel.revision,blockId:block.id,status:'ready',table});
  }catch{
   if(generation!==this.generation||!this.active||!this.allowed())return;
   const table=this.cache.get(key);this.publish({kind:'live_query',panelId:panel.id,revision:panel.revision,blockId:block.id,status:table?'stale':'error',table,error:'הרענון נכשל. הנתונים הקודמים, אם מוצגים, אינם עדכניים.'});
  }finally{
   if(timeout)clearTimeout(timeout);if(abort)controller.signal.removeEventListener('abort',abort);this.controllers.delete(controller);
   if(generation===this.generation&&this.active&&this.allowed()){
    const timer=setTimeout(()=>{this.timers.delete(timer);void this.refresh(panel,block,key,generation);},Math.max(0,(this.nextAllowed.get(block.source)??0)-Date.now()));timer.unref();this.timers.add(timer);
   }
  }
 }
}

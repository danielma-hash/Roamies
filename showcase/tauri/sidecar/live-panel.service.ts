import { randomUUID } from 'node:crypto';
import { livePanelSpecSchema } from './live-panel.schema.js';
import type { LivePanelEnvelope } from './live-panel.types.js';
import type { LivePanelStoreService } from './live-panel-store.service.js';
import type { LivePanelArchive } from './live-panel.types.js';
import {LivePanelError} from './live-panel.error.js';
export class LivePanelService {
 private archive:LivePanelArchive={version:1,panels:[]};
 private current?:LivePanelEnvelope;
 private rendered=false;
 private complete?: (rendered:boolean)=>void;
 private readonly ready:Promise<void>;
 private mutations:Promise<unknown>=Promise.resolve();
 constructor(private readonly store?:Pick<LivePanelStoreService,'load'|'save'>){
  this.ready=(async()=>{if(store){this.archive=await store.load();this.current=this.archive.panels.find(history=>history[0]!.id===this.archive.selectedId)?.at(-1);}})();
  void this.ready.catch(()=>undefined);
 }
 initialize():Promise<void>{return this.ready;}
 async flush():Promise<void>{await this.mutations;}
 private mutate<T>(operation:()=>Promise<T>):Promise<T>{
  const result=this.mutations.then(async()=>{await this.ready;return operation();});this.mutations=result.catch(()=>undefined);return result;
 }
 private async commit(next:LivePanelArchive):Promise<void>{await this.store?.save(next);this.archive=next;}
 private display(panel:LivePanelEnvelope):LivePanelEnvelope{this.complete?.(false);this.rendered=false;this.current=panel;return structuredClone(panel);}
 show(input:unknown):Promise<LivePanelEnvelope>{
  const spec=livePanelSpecSchema.parse(input);
  return this.mutate(async()=>{
   if(this.archive.panels.length>=20)throw new LivePanelError('limit');
   const panel={id:randomUUID(),revision:1,createdAt:new Date().toISOString(),spec};
   await this.commit({...this.archive,selectedId:panel.id,panels:[...this.archive.panels,[panel]]});return this.display(panel);
  });
 }
 update(id:string,expectedRevision:number,input:unknown):Promise<LivePanelEnvelope>{
  const spec=livePanelSpecSchema.parse(input);
  return this.mutate(async()=>{
   const history=this.archive.panels.find(entries=>entries[0]!.id===id);if(!history)throw new LivePanelError('missing');
   const previous=history.at(-1)!;if(previous.revision!==expectedRevision)throw new LivePanelError('conflict');
   const panel={...previous,revision:previous.revision+1,updatedAt:new Date().toISOString(),spec};
   await this.commit({...this.archive,selectedId:id,panels:this.archive.panels.map(entries=>entries===history?[...entries,panel].slice(-5):entries)});return this.display(panel);
  });
 }
 open(id:string):Promise<LivePanelEnvelope>{return this.mutate(async()=>{
  const panel=this.archive.panels.find(history=>history[0]!.id===id)?.at(-1);if(!panel)throw new LivePanelError('missing');
  await this.commit({...this.archive,selectedId:id});return this.display(panel);
 });}
 async read(id:string,revision?:number):Promise<LivePanelEnvelope>{
  await this.ready;await this.mutations;
  const history=this.archive.panels.find(entries=>entries[0]!.id===id);const panel=revision===undefined?history?.at(-1):history?.find(entry=>entry.revision===revision);
  if(!panel)throw new LivePanelError('missing');return structuredClone(panel);
 }
 list(){return this.archive.panels.map(history=>{const panel=history.at(-1)!;return {id:panel.id,title:panel.spec.title,revision:panel.revision,createdAt:panel.createdAt,updatedAt:panel.updatedAt,revisions:history.map(entry=>entry.revision)};});}
 snapshot():LivePanelEnvelope|undefined{return this.current?structuredClone(this.current):undefined;}
 markRendered(id:unknown,revision:unknown):boolean{
  if(!this.current||id!==this.current.id||revision!==this.current.revision)return false;
  this.rendered=true;this.complete?.(true);return true;
 }
 waitForRender(id:string,signal?:AbortSignal,revision?:number):Promise<boolean>{
  if(signal?.aborted||id!==this.current?.id||revision!==undefined&&revision!==this.current?.revision)return Promise.resolve(false);
  if(this.rendered)return Promise.resolve(true);
  return new Promise(resolve=>{
   const finish=(rendered:boolean):void=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(this.complete===finish)this.complete=undefined;resolve(rendered);};
   const abort=():void=>finish(false);const timer=setTimeout(()=>finish(false),5000);timer.unref();
   this.complete?.(false);this.complete=finish;signal?.addEventListener('abort',abort,{once:true});
  });
 }
}

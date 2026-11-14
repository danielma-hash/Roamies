import { randomUUID } from 'node:crypto';
import { livePanelSpecSchema } from './live-panel.schema.js';
import type { LivePanelEnvelope } from './live-panel.types.js';
export class LivePanelService {
 private current?:LivePanelEnvelope;
 private rendered=false;
 private complete?: (rendered:boolean)=>void;
 show(input:unknown):LivePanelEnvelope {
  const spec=livePanelSpecSchema.parse(input);this.complete?.(false);this.rendered=false;
  this.current={id:randomUUID(),revision:1,createdAt:new Date().toISOString(),spec};return structuredClone(this.current);
 }
 snapshot():LivePanelEnvelope|undefined {return this.current?structuredClone(this.current):undefined;}
 markRendered(id:unknown,revision:unknown):boolean {
  if(!this.current||id!==this.current.id||revision!==this.current.revision)return false;
  this.rendered=true;this.complete?.(true);return true;
 }
 waitForRender(id:string,signal?:AbortSignal):Promise<boolean>{
  if(signal?.aborted||id!==this.current?.id)return Promise.resolve(false);
  if(this.rendered)return Promise.resolve(true);
  return new Promise(resolve=>{
   const finish=(rendered:boolean):void=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(this.complete===finish)this.complete=undefined;resolve(rendered);};
   const abort=():void=>finish(false);const timer=setTimeout(()=>finish(false),5000);timer.unref();
   this.complete?.(false);this.complete=finish;signal?.addEventListener('abort',abort,{once:true});
  });
 }
}

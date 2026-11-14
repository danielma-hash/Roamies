import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {ToolContext} from '@kenkaiiii/gg-agent';
import type {LiveQueryMessage} from './live-query.types.js';
import type {LivePanelEnvelope} from './live-panel.types.js';
import type {PanelSessionAction,PanelSessionExecutor,PanelViewBinding,PanelActionInput} from './panel-action.types.js';
import {panelActionInputSchema} from './panel-action.schema.js';
import {PanelActionError} from './panel-action.error.js';
/** A recent, acknowledged visual order. Labels are data; only opaque refs select an action target. */
export class PanelActionService {
 private view?:{panelId:string;revision:number;blockId:string;title:string;binding:PanelViewBinding;labels:string[];shownAt:number;visible:string[]};
 private readonly receipts=new Map<string,{fingerprint:string;promise:Promise<string>}>();
 constructor(private readonly panel:()=>LivePanelEnvelope|undefined,private readonly enabled:()=>boolean,private readonly actions:(id:string)=>PanelSessionAction[],private readonly execute:PanelSessionExecutor){}
 decorate(message:LiveQueryMessage):LiveQueryMessage{
  const panel=this.panel();const block=panel?.spec.blocks.find(block=>block.id===message.blockId);
  if(['stale','error'].includes(message.status)&&this.view?.blockId===message.blockId)this.clear();
  if(message.status!=='ready'||!message.table||block?.kind!=='query'||block.source!=='sessions'||panel?.id!==message.panelId||panel.revision!==message.revision)return message;
  const rows=message.table.rowIds.map(id=>({ref:randomUUID(),targetId:z.uuid().parse(id),actions:this.actions(id)}));
  const binding={viewId:randomUUID(),rows};this.view={panelId:panel.id,revision:panel.revision,blockId:block.id,title:block.title,binding,labels:message.table.rows.map(row=>row[0]??''),shownAt:0,visible:[]};
  return {...message,binding};
 }
 acknowledge(viewId:unknown,refs:unknown):boolean{
  const parsed=z.array(z.uuid()).max(10).safeParse(refs);const view=this.view;
  if(!view||view.binding.viewId!==viewId||!parsed.success||new Set(parsed.data).size!==parsed.data.length||parsed.data.some(ref=>!view.binding.rows.some(row=>row.ref===ref))||!this.validScope())return false;
  view.visible=parsed.data;view.shownAt=Date.now();return true;
 }
 clear():void{this.view=undefined;}
 private validScope():boolean{const panel=this.panel();return !!this.view&&this.enabled()&&panel?.id===this.view.panelId&&panel.revision===this.view.revision;}
 context(){
  if(!this.validScope()||!this.view?.shownAt||Date.now()-this.view.shownAt>120_000)return {available:false as const,reason:'אין תצוגת סשנים שאושרה מהחלון בשתי הדקות האחרונות.'};
  const view=this.view;return {available:true as const,panelId:view.panelId,revision:view.revision,blockId:view.blockId,title:view.title,shownAt:view.shownAt,untrustedLabels:true,rows:view.visible.map((ref,index)=>{const rowIndex=view.binding.rows.findIndex(row=>row.ref===ref);const row=view.binding.rows[rowIndex]!;return {position:index+1,ref,title:view.labels[rowIndex],actions:row.actions,used:this.receipts.has(ref)};})};
 }
 act(input:PanelActionInput,context?:ToolContext):Promise<string>{
  const value=panelActionInputSchema.parse(input);context?.signal?.throwIfAborted();
  const fingerprint=JSON.stringify(value);const previous=this.receipts.get(value.ref);
  if(previous){if(previous.fingerprint!==fingerprint)throw new PanelActionError();return previous.promise;}
  const current=this.context();if(!current.available||!current.rows.some(row=>row.ref===value.ref))throw new PanelActionError();
  const row=this.view!.binding.rows.find(row=>row.ref===value.ref)!;
  if(!row.actions.includes(value.action)||!this.actions(row.targetId).includes(value.action)||value.action!=='stop'&&!value.instruction)throw new PanelActionError();
  // Capture identity before any approval awaits. A later sort can never retarget this action.
  const id=row.targetId;const promise=Promise.resolve().then(()=>this.execute(value.action,id,value.instruction,context));
  this.receipts.set(value.ref,{fingerprint,promise});if(this.receipts.size>20)this.receipts.delete(this.receipts.keys().next().value!);void promise.catch(()=>undefined);return promise;
 }
}

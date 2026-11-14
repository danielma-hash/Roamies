import {z} from 'zod';
const key=z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/);
const entrySchema=z.strictObject({panelId:z.uuid(),blockId:key,signature:z.string().max(24000),values:z.record(key,z.string().max(400)).refine(values=>Object.keys(values).length<=12)});
const stateSchema=z.strictObject({version:z.literal(1),entries:z.array(entrySchema).max(240)}).superRefine((state,ctx)=>{
 const keys=state.entries.map(entry=>`${entry.panelId}:${entry.blockId}`);if(new Set(keys).size!==keys.length)ctx.addIssue({code:'custom',message:'מזהה טיוטה כפול.'});
});
const STORAGE_KEY='roamies.live-panel-state.v1';
const MAX_BYTES=256_000;
/** Local UI state only. Never sent to the agent or interpreted as an action. */
export class PanelViewStateService {
 private entries:z.infer<typeof entrySchema>[]=[];
 private broken=false;
 private problem?:string;
 constructor(private readonly storage:Pick<Storage,'getItem'|'setItem'>){
  try{
   const raw=storage.getItem(STORAGE_KEY);if(raw){if(new TextEncoder().encode(raw).byteLength>MAX_BYTES)throw new Error('size');this.entries=stateSchema.parse(JSON.parse(raw)).entries;}
  }catch{this.broken=true;this.problem='שמירת הטיוטות אינה זמינה. המידע הקודם לא אופס.';}
 }
 get error():string|undefined{return this.problem;}
 read(panelId:string,blockId:string,signature:string):Readonly<Record<string,string>>|undefined{
  const entry=this.entries.find(item=>item.panelId===panelId&&item.blockId===blockId&&item.signature===signature);return entry?{...entry.values}:undefined;
 }
 save(panelId:string,blockId:string,signature:string,values:Readonly<Record<string,string>>):boolean{
  if(this.broken)return false;
  try{
   const entry=entrySchema.parse({panelId,blockId,signature,values});
   const next=stateSchema.parse({version:1,entries:[...this.entries.filter(item=>item.panelId!==panelId||item.blockId!==blockId),entry]});
   const text=JSON.stringify(next);if(new TextEncoder().encode(text).byteLength>MAX_BYTES)throw new Error('size');
   this.storage.setItem(STORAGE_KEY,text);this.entries=next.entries;this.problem=undefined;return true;
  }catch{this.problem='השינוי מוצג, אך הטיוטה לא נשמרה. ייתכן שהאחסון המקומי מלא או חסום.';return false;}
 }
}

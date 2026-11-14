import {z} from 'zod';
const librarySchema=z.strictObject({kind:z.literal('live_panel_library'),selectedId:z.uuid().optional(),error:z.string().max(1000).optional(),panels:z.array(z.strictObject({id:z.uuid(),title:z.string().max(120),revision:z.number().int().positive(),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime().optional(),revisions:z.array(z.number().int().positive()).max(5)})).max(20)});
export class PanelLibraryView {
 private readonly select=document.createElement('select');
 private readonly status=document.createElement('p');
 private signature='';
 constructor(root:HTMLElement,open:(id:string)=>Promise<unknown>){
  const label=document.createElement('label');label.textContent='מסכים שמורים';this.select.setAttribute('aria-label','מסכים שמורים');label.append(this.select);this.status.setAttribute('role','status');root.classList.add('panel-library');root.append(label,this.status);
  this.select.addEventListener('change',()=>{const id=this.select.value;if(!id)return;this.select.disabled=true;void open(id).catch(()=>{this.status.textContent='לא ניתן לפתוח את המסך.';}).finally(()=>{this.select.disabled=false;});});
 }
 receive(input:unknown):void{
  const parsed=librarySchema.safeParse(input);if(!parsed.success)return;const state=parsed.data;const signature=JSON.stringify(state);if(signature===this.signature)return;this.signature=signature;
  this.select.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='בחירת מסך שמור';this.select.append(empty);
  for(const panel of state.panels){const option=document.createElement('option');option.value=panel.id;option.textContent=`${panel.title} · גרסה ${panel.revision}`;this.select.append(option);}
  this.select.value=state.selectedId??'';this.status.textContent=state.error??`${state.panels.length} מתוך 20 מסכים · נשמרות עד 5 גרסאות לכל מסך`;
 }
}

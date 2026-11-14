import type {z} from 'zod';
import {taskHistorySnapshotSchema} from './task-history.schema.js';
type Snapshot=z.infer<typeof taskHistorySnapshotSchema>;
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text=''):HTMLElementTagNameMap[K]=>{const el=document.createElement(tag);el.textContent=text;return el;};
const labels:Readonly<Record<string,string>>={queued:'בתור',running:'פועלת',returned:'התקבלה תשובה',failed:'נכשלה',interrupted:'נקטעה'};
export class TaskHistoryView {
  private archived=false;
  private page=1;
  private readonly search=element('input');
  private readonly controls=element('div');
  private readonly body=element('div');
  private readonly notice=element('p');
  private requestId?:string;
  private timer?:ReturnType<typeof setTimeout>;
  constructor(private readonly root:HTMLElement,private readonly send:(message:unknown)=>Promise<unknown>){
    root.append(element('h1','המשימות של ג׳ארוויס'),element('p','העברה לארכיון שומרת את ההתקדמות. שחזור לרשימה אינו מפעיל את המשימה מחדש.'),this.controls,this.notice,this.body);
    this.controls.className='header-actions';this.search.type='search';this.search.placeholder='חיפוש בבקשות';this.search.setAttribute('aria-label','חיפוש משימות');this.search.maxLength=200;this.search.dir='auto';
    this.controls.append(this.search,this.button('חיפוש ורענון',()=>{this.page=1;this.refresh();}),this.button('הרשימה הראשית',()=>{this.archived=false;this.page=1;this.refresh();}),this.button('ארכיון',()=>{this.archived=true;this.page=1;this.refresh();}));
    this.search.addEventListener('keydown',e=>{if(e.key==='Enter'){this.page=1;this.refresh();}});this.notice.setAttribute('role','status');
  }
  private button(text:string,run:()=>void){const button=element('button',text);button.type='button';button.addEventListener('click',run);return button;}
  refresh():void{void this.request({action:'list'});}
  private enable(on:boolean){this.root.querySelectorAll<HTMLButtonElement|HTMLInputElement>('button,input').forEach(el=>{el.disabled=!on||el.dataset.unavailable==='true';});}
  private async request(action:Record<string,unknown>){
    if(this.requestId)return;
    const requestId=crypto.randomUUID();this.requestId=requestId;this.enable(false);this.notice.textContent='מעדכן את ההיסטוריה…';
    this.timer=setTimeout(()=>{if(this.requestId===requestId){this.requestId=undefined;this.enable(true);this.notice.textContent='לא התקבלה תשובה. אפשר לרענן; הפעולה לא נשלחה שוב.';}},15_000);
    try{await this.send({type:'task_history',...action,requestId,filter:{archived:this.archived,page:this.page,query:this.search.value}});}
    catch{if(this.requestId===requestId){clearTimeout(this.timer);this.requestId=undefined;this.enable(true);this.notice.textContent='החיבור נותק. הפעולה לא נשלחה שוב.';}}
  }
  receive(raw:unknown):void{
    if(!this.requestId||!raw||typeof raw!=='object'||!('requestId'in raw)||raw.requestId!==this.requestId)return;
    clearTimeout(this.timer);this.requestId=undefined;this.enable(true);
    if('error'in raw&&typeof raw.error==='string'){this.notice.textContent=raw.error.slice(0,300);return;}
    const parsed=taskHistorySnapshotSchema.safeParse('snapshot'in raw?raw.snapshot:undefined);
    if(!parsed.success){this.notice.textContent='תשובת היומן אינה תקינה.';return;}
    this.render(parsed.data);
  }
  private render(snapshot:Snapshot){
    this.archived=snapshot.archived;this.page=snapshot.page;
    this.notice.textContent=`${snapshot.archived?'ארכיון':'רשימה ראשית'} — ${snapshot.total} משימות. עודכן ב־${new Date(snapshot.observedAt).toLocaleTimeString('he-IL')}. חזרת תשובה אינה אימות הצלחה.`;
    this.body.replaceChildren();
    if(!snapshot.rows.length)this.body.append(element('p','אין משימות בתצוגה הזאת.'));
    for(const row of snapshot.rows){
      const card=element('section');card.className='approval';const title=element('h2',row.request);title.dir='auto';
      const action=this.button(row.archived?'החזרה לרשימה':'העברה לארכיון',()=>{void this.request({action:'archive',input:{id:row.id,expectedUpdatedAt:row.updatedAt,archived:!row.archived}});});
      action.dataset.unavailable=String(!snapshot.actions||['running','queued'].includes(row.status));action.disabled=action.dataset.unavailable==='true';
      card.append(title,element('p',`${labels[row.status]} · ${row.tools} קריאות כלים · ${row.uncertain} דורשות בירור`),action);this.body.append(card);
    }
    const navigation=element('div');navigation.className='header-actions';
    if(snapshot.page>1)navigation.append(this.button('הקודם',()=>{this.page--;this.refresh();}));
    if(snapshot.page*20<snapshot.total)navigation.append(this.button('הבא',()=>{this.page++;this.refresh();}));
    this.body.append(navigation);
    if(!snapshot.actions)this.body.append(element('p','הצפייה זמינה. לשינוי הארכיון יש להפעיל פעולות בהגדרות.'));
  }
}

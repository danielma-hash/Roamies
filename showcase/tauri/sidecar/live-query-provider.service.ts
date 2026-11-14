import type {ClaudeSessionsService} from './claude-sessions.service.js';
import type {ClaudeRunService} from './claude-run.service.js';
import type {TaskCardsService} from './task-cards.service.js';
import type {AttentionService} from './attention.service.js';
import type {LiveQuerySource,LiveQueryTable} from './live-query.types.js';
const status:Readonly<Record<string,string>>={running:'פועל',waiting:'ממתין',idle:'מוכן',ended:'הסתיים',unknown:'לא ידוע',starting:'מתחיל',stopped:'נעצר',failed:'נכשל',interrupted:'נקטע',OPEN:'פתוח',CLOSED:'סגור',MERGED:'מוזג'};
const clipped=(value:string):string=>value.slice(0,200);
const time=(timestamp:number):string=>new Date(timestamp).toLocaleString('he-IL');
export class LiveQueryProviderService {
 constructor(private readonly sessions:Pick<ClaudeSessionsService,'list'>,private readonly runs:Pick<ClaudeRunService,'list'>,private readonly cards:Pick<TaskCardsService,'list'|'read'>,private readonly attention:Pick<AttentionService,'snapshot'>){}
 async read(source:LiveQuerySource,query:string,signal:AbortSignal):Promise<LiveQueryTable>{
  signal.throwIfAborted();const matches=(text:string)=>text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  if(source==='sessions'){
   const list=await this.sessions.list({limit:100});signal.throwIfAborted();if(!list.available)throw new Error('רשימת הסשנים אינה זמינה.');
   const owned=this.runs.list();const ids=new Set(owned.map(run=>run.id));
   const rows=[...owned.map(run=>({id:run.id,title:run.title,cwd:run.cwd,status:run.state,kind:'מנוהל'})),...list.sessions.filter(session=>!ids.has(session.id)).map(session=>({...session,kind:'היסטוריה / אירועים'}))].filter(row=>matches(`${row.title} ${row.cwd}`)).slice(0,10);
   return {columns:['סשן','מצב','מקור'],rows:rows.map(row=>[clipped(row.title),status[row.status]??row.status,row.kind]),rowIds:rows.map(row=>row.id),observedAt:Date.now(),source:'Claude — סשנים מנוהלים והיסטוריה; סטטוס היסטוריה אינו אימות תהליך'};
  }
  if(source==='prs'){
   const tracked=this.cards.list().filter(card=>matches(`${card.title} ${card.url}`)).slice(0,5);
   const cards=await Promise.all(tracked.map(card=>this.cards.read(card.url,card.monday,signal)));signal.throwIfAborted();
   return {columns:['PR','מצב','בדיקות','נבדק'],rows:cards.map(card=>[clipped(card.title),status[card.state]??card.state,clipped(card.statusCheckRollup?.map(check=>check.conclusion||check.state||check.status||'לא ידוע').join(', ')||'אין נתוני בדיקות'),time(card.observedAt)]),rowIds:cards.map(card=>card.url),observedAt:Date.now(),source:'GitHub — עד 5 PRs שכבר נוספו למעקב, קריאה דרך gh'};
  }
  const snapshot=await this.attention.snapshot();signal.throwIfAborted();
  const labels:Readonly<Record<string,string>>={'session-waiting':'סשן ממתין','session-ended':'סשן הסתיים','checks-failed':'בדיקות נכשלו','checks-passed':'בדיקות עברו'};
  const events=snapshot.events.filter(event=>event.dismissedAt===undefined&&matches(event.title)).slice(-10).reverse();
  return {columns:['התראה','סוג','נוצרה'],rows:events.map(event=>[clipped(event.title),labels[event.kind]??event.kind,time(event.createdAt)]),rowIds:events.map(event=>event.id),observedAt:Date.now(),source:'תיבת ההתראות המקומית — עד 10 התראות שלא נקראו'};
 }
}

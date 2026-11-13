import { constants } from 'node:fs';
import { open, readdir, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { redactClaudeText } from './claude-sessions.service.js';
const ID = /^\d{8}-\d{6}-[a-z0-9]{6}$/;
const schema = z.object({ version:z.literal(1),id:z.string().regex(ID),provider:z.string(),model:z.string(),startedAt:z.number(),lastActiveAt:z.number().optional(),messages:z.array(z.object({role:z.string(),content:z.unknown()}).passthrough()),kind:z.string().optional() }).passthrough();
export type SavedConversation = z.infer<typeof schema>;
export interface ConversationSummary { readonly id:string; readonly title:string; readonly updatedAt:number; readonly bookmarked:boolean; readonly preview:string }
function text(content:unknown):string { if(typeof content==='string')return content; if(!Array.isArray(content))return ''; return content.flatMap((p:unknown)=>typeof p==='object'&&p!==null&&'type'in p&&p.type==='text'&&'text'in p&&typeof p.text==='string'?[p.text]:[]).join('\n'); }
export class ConversationWorkspaceService {
  private bookmarks = new Set<string>();
  constructor(private readonly directory:string) {}
  async load():Promise<void> { try { const file=await this.readJson(join(this.directory,'bookmarks.json')); if(Array.isArray(file))this.bookmarks=new Set(file.filter((x):x is string=>typeof x==='string'&&ID.test(x))); }catch{/* Optional metadata does not hide conversations. */} }
  private async readJson(path:string):Promise<unknown> {const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await handle.stat();if(!stat.isFile()||stat.size>8*1024*1024)throw new Error('השיחה גדולה מדי לתצוגה.');return JSON.parse(await handle.readFile('utf8')) as unknown;}finally{await handle.close();}}
  async read(id:string):Promise<SavedConversation> {if(!ID.test(id))throw new Error('מזהה השיחה אינו תקין.');const value=schema.parse(await this.readJson(join(this.directory,'sessions',`${id}.json`)));if(value.id!==id||value.kind==='intro')throw new Error('השיחה אינה זמינה.');return value;}
  async list(query=''):Promise<readonly ConversationSummary[]> {
    let files:string[];try{files=await readdir(join(this.directory,'sessions'));}catch{return [];}
    const result:ConversationSummary[]=[];
    for(const file of files.filter(f=>f.endsWith('.json')&&ID.test(f.slice(0,-5))).sort((a,b)=>Number(this.bookmarks.has(b.slice(0,-5)))-Number(this.bookmarks.has(a.slice(0,-5)))||b.localeCompare(a)).slice(0,100)){
      try{const session=await this.read(file.slice(0,-5));const messages=session.messages.filter(m=>m.role==='user'||m.role==='assistant').map(m=>redactClaudeText(text(m.content))).filter(Boolean);
        if(query&&!messages.some(m=>m.toLocaleLowerCase().includes(query.toLocaleLowerCase())))continue;
        result.push({id:session.id,title:(messages[0]||'שיחה ללא כותרת').slice(0,90),updatedAt:session.lastActiveAt??session.startedAt,bookmarked:this.bookmarks.has(session.id),preview:(messages.at(-1)||'').slice(0,180)});
      }catch{/* One corrupt conversation does not hide other history. */}
    }return result.sort((a,b)=>Number(b.bookmarked)-Number(a.bookmarked)||b.updatedAt-a.updatedAt);
  }
  async bookmark(id:string,on:boolean):Promise<void>{await this.read(id);const next=new Set(this.bookmarks);if(on)next.add(id);else next.delete(id);await mkdir(this.directory,{recursive:true,mode:0o700});const file=join(this.directory,'bookmarks.json'),tmp=`${file}.${randomUUID()}.tmp`;await writeFile(tmp,JSON.stringify([...next]),{mode:0o600,flag:'wx'});await rename(tmp,file);this.bookmarks=next;}
  async preview(id:string):Promise<readonly {role:string;text:string}[]>{const session=await this.read(id);return session.messages.filter(m=>m.role==='user'||m.role==='assistant').slice(-40).map(m=>({role:m.role,text:redactClaudeText(text(m.content)).slice(0,4000)}));}
}

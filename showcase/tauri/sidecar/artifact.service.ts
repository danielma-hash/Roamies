import {open,mkdir,realpath,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
// @ts-expect-error Existing application safety policy.
import {checkWrite,SAFE} from './safety.mjs';
import {redactClaudeText} from './claude-sessions.service.js';
import {artifactSchema} from './artifact.schema.js';
import {ArtifactError} from './artifact-error.js';
import type {ArtifactInput,ArtifactOptions} from './artifact.types.js';

const escape=(value:unknown):string=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const hash=(value:Buffer):string=>createHash('sha256').update(value).digest('hex');
function csvCell(value:unknown):string {
  let text=String(value??'');
  // Spreadsheet import can ignore leading whitespace/bidi before a formula.
  if(typeof value==='string'&&/^[=+\-@]/.test(text.replace(/^[\s\u200e\u200f\u202a-\u202e\u2066-\u2069]+/u,'')))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
function render(input:ArtifactInput):string {
  const sources=input.sources??[];
  if(input.format==='csv') {
    const table=input.table!;
    const sourceText=sources.map(s=>`${s.title}: ${s.url}${s.accessedAt?` (${s.accessedAt})`:''}`).join('\n');
    const rows=[table.columns,...table.rows].map((row,index)=>[...row,...(sources.length?[index===0?'מקורות':sourceText]:[])]);
    return '\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
  }
  const table=input.table?`<div class="table"><table><thead><tr>${input.table.columns.map(c=>`<th scope="col"><bdi>${escape(c)}</bdi></th>`).join('')}</tr></thead><tbody>${input.table.rows.map(row=>`<tr>${row.map(c=>`<td><bdi>${escape(c)}</bdi></td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'';
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(input.title)}</title><style>body{margin:0;background:#f5f6f8;color:#17202d;font:17px/1.75 -apple-system,BlinkMacSystemFont,Arial,sans-serif}main{max-width:960px;margin:40px auto;padding:40px;background:white;border-radius:18px;border:1px solid #dce2e9}h1{font-size:32px;line-height:1.3;margin:0 0 24px}h2{font-size:22px;margin-top:36px}.text{white-space:pre-wrap;unicode-bidi:plaintext;overflow-wrap:anywhere}.table{overflow-x:auto}table{border-collapse:collapse;width:100%;margin-top:24px}th,td{padding:12px;text-align:start;border-bottom:1px solid #dce2e9;vertical-align:top;overflow-wrap:anywhere}th{background:#eef2f6}bdi{white-space:pre-wrap}a{color:#0759a5;overflow-wrap:anywhere}li{margin:12px 0}small,footer{color:#4d5968}footer{margin-top:36px;font-size:13px}@media(max-width:600px){main{margin:12px;padding:20px}h1{font-size:26px}}@media print{body{background:white}main{margin:0;padding:0;border:0}th{print-color-adjust:exact}a{color:inherit}}</style></head><body><main><h1><bdi>${escape(input.title)}</bdi></h1>${input.text?`<div class="text">${escape(input.text)}</div>`:''}${table}${sources.length?`<section aria-label="מקורות"><h2>מקורות</h2><ol>${sources.map(s=>`<li><a href="${escape(s.url)}" rel="noreferrer noopener"><bdi>${escape(s.title)}</bdi></a><br><bdi dir="ltr">${escape(s.url)}</bdi>${s.accessedAt?`<br><small>תאריך המקור או הבדיקה: <bdi>${escape(s.accessedAt)}</bdi></small>`:''}</li>`).join('')}</ol></section>`:''}<footer>נוצר באמצעות Jarvis. המקורות והתוכן מוצגים כפי שסופקו; שמירת הקובץ אינה אימות של הטענות.</footer></main></body></html>`;
}

/** Writes bounded inert reports in one fixed directory; matching retries reuse the verified file. */
export class ArtifactService {
  private tail:Promise<unknown>=Promise.resolve();
  constructor(private readonly options:ArtifactOptions){}
  create(raw:unknown,signal?:AbortSignal){const input=artifactSchema.parse(raw);const next=this.tail.then(()=>this.write(input,signal));this.tail=next.catch(()=>undefined);return next;}
  private async write(input:ArtifactInput,signal?:AbortSignal){
    signal?.throwIfAborted();
    if(!this.options.allowed())throw new ArtifactError('שמירת תוצרים דורשת הפעלת פעולות.');
    if(input.table?.rows.some(row=>row.length!==input.table!.columns.length))throw new ArtifactError('מספר התאים אינו תואם לכותרות הטבלה.');
    if(input.format==='csv'&&(!input.table||input.text))throw new ArtifactError('CSV דורש טבלה וללא טקסט נפרד; למסמך מלא בחר HTML.');
    for(const source of input.sources??[]){let url:URL;try{url=new URL(source.url);}catch{throw new ArtifactError('כתובת המקור אינה תקינה.');}if(url.protocol!=='https:'||url.username||url.password)throw new ArtifactError('מקורות חייבים להיות כתובות HTTPS ללא פרטי התחברות.');}
    // Redaction operates on raw fields, not escaped JSON.
    const rawText=[input.title,input.text??'',...(input.table?.columns??[]),...(input.table?.rows.flat().map(String)??[]),...(input.sources??[]).flatMap(s=>[s.title,s.url,s.accessedAt??''])];
    if(rawText.some(text=>redactClaudeText(text)!==text))throw new ArtifactError('התוצר כולל מידע שנראה רגיש; יש להסירו לפני שמירה.');
    const bytes=Buffer.from(render(input),'utf8');if(bytes.length>524_288)throw new ArtifactError('התוצר חורג ממגבלת הגודל.');
    const digest=hash(bytes),root=resolve(this.options.root??join(homedir(),'Roamies Exports')),file=join(root,`report-${digest}.${input.format}`);
    if(checkWrite(file,homedir()).level!==SAFE)throw new ArtifactError('תיקיית התוצרים אינה מותרת לכתיבה.');
    await mkdir(root,{recursive:true,mode:0o700});if(await realpath(root)!==root)throw new ArtifactError('תיקיית התוצרים אינה יכולה להיות קישור סמלי.');
    signal?.throwIfAborted();
    if(!this.options.allowed())throw new ArtifactError('הרשאת שמירת תוצרים בוטלה.');
    let created=true;
    try{const handle=await open(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
    catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST')created=false;else throw new ArtifactError('שמירת התוצר נכשלה.');}
    const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
      const stat=await handle.stat();if(!stat.isFile()||stat.size!==bytes.length||stat.nlink!==1)throw new ArtifactError('קובץ התוצר אינו תואם; הוא לא נדרס.');
      const saved=Buffer.alloc(bytes.length+1);let count=0;
      while(count<saved.length){const read=await handle.read(saved,count,saved.length-count,count);if(!read.bytesRead)break;count+=read.bytesRead;}
      const current=await lstat(file);
      if(count!==bytes.length||hash(saved.subarray(0,count))!==digest||current.ino!==stat.ino||current.dev!==stat.dev||!current.isFile())throw new ArtifactError('אימות הקובץ שנשמר נכשל.');
    }finally{await handle.close();}
    return {path:file,url:pathToFileURL(file).href,format:input.format,title:input.title,bytes:bytes.length,sha256:digest,created,fileVerified:true,contentVerified:false,observedAt:new Date().toISOString(),note:'הקובץ נשמר ונקרא בחזרה. התוכן והמקורות לא אומתו; אפשר לפתוח את path בכלי open.'};
  }
}

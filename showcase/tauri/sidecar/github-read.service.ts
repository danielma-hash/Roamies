import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {posix} from 'node:path';
// @ts-expect-error Existing app safety module is JavaScript.
import {checkGitHubRead,checkRead,SAFE} from './safety.mjs';
import {redactClaudeText} from './claude-sessions.service.js';
import {GitHubReadError} from './github-read-error.js';
import {githubReadSchema,githubPinnedSchema,githubPatchSchema,githubPrSchema,githubIssueSchema,githubFilesSchema,githubChecksSchema,githubStatusesSchema} from './github-read.schema.js';
import type {GitHubGet,GitHubReadInput,GitHubPinnedInput,GitHubPatchInput} from './github-read.types.js';

const exec=promisify(execFile);
const clean=(text:string,limit:number):string=>redactClaudeText(text).slice(0,limit);
async function get(endpoint:string,signal?:AbortSignal):Promise<unknown>{
 try{
  const {stdout}=await exec('gh',['api','--hostname','github.com','--method','GET','--header','Accept: application/vnd.github+json',endpoint],{encoding:'utf8',timeout:15_000,maxBuffer:1_048_576,signal});
  return JSON.parse(stdout) as unknown;
 }catch{throw new GitHubReadError('קריאת GitHub נכשלה או בוטלה. יש לבדוק חיבור gh והרשאת קריאה; אין כאן תוצאה מאומתת.');}
}
function target(url:string,kind:'pull'|'issues'):{endpoint:string;number:number}{
 const result=checkGitHubRead(url);
 if(result.level!==SAFE||result.kind!==kind)throw new GitHubReadError('נדרש קישור GitHub מדויק מהסוג המתאים.');
 return {endpoint:`repos/${result.owner}/${result.repo}`,number:result.number as number};
}
function identity(actual:string,expected:string,number:number,expectedNumber:number):void{
 if(actual.toLowerCase()!==expected.toLowerCase()||number!==expectedNumber)throw new GitHubReadError('זהות הרשומה השתנתה או אינה תואמת לקישור. יש להשתמש בקישור העדכני.');
}
function readable(filename:string):boolean{
 return !filename.includes('\\')&&!filename.includes('\0')&&!posix.isAbsolute(filename)&&!filename.split('/').some(part=>part==='..'||part==='.')&&checkRead(posix.join(homedir(),'github-review',filename),homedir()).level===SAFE;
}
/** Read-only, bounded GitHub adapter. A before/after SHA check detects drift; it is not a repository lock. */
export class GitHubReadService {
 constructor(private readonly request:GitHubGet=get){}
 private receipt(url:string){return {source:url,observedAt:new Date().toISOString(),untrustedContent:true,deployment:'unknown' as const};}
 private async rawPr(url:string,signal?:AbortSignal){
  const ref=target(url,'pull');const pr=githubPrSchema.parse(await this.request(`${ref.endpoint}/pulls/${ref.number}`,signal));
  identity(pr.html_url,url,pr.number,ref.number);return pr;
 }
 async pr(input:GitHubReadInput,signal?:AbortSignal){
  const {url}=githubReadSchema.parse(input);const pr=await this.rawPr(url,signal);
  return {...this.receipt(url),title:clean(pr.title,200),body:clean(pr.body??'',4000),bodyTruncated:(pr.body?.length??0)>4000,state:pr.state,draft:pr.draft,merged:pr.merged,head:{sha:pr.head.sha,ref:clean(pr.head.ref,200)},base:{sha:pr.base.sha,ref:clean(pr.base.ref,200)},changedFiles:pr.changed_files,updatedAt:pr.updated_at};
 }
 async issue(input:GitHubReadInput,signal?:AbortSignal){
  const {url}=githubReadSchema.parse(input);const ref=target(url,'issues');const issue=githubIssueSchema.parse(await this.request(`${ref.endpoint}/issues/${ref.number}`,signal));
  identity(issue.html_url,url,issue.number,ref.number);if(issue.pull_request!==undefined)throw new GitHubReadError('זו בקשת PR. יש להשתמש בקישור pull ובכלי קריאת PR.');
  return {...this.receipt(url),title:clean(issue.title,200),body:clean(issue.body??'',4000),bodyTruncated:(issue.body?.length??0)>4000,state:issue.state,labels:issue.labels.slice(0,20).map(label=>clean(label.name,100)),labelsTruncated:issue.labels.length>20,updatedAt:issue.updated_at};
 }
 private async pinned(input:GitHubPinnedInput,signal?:AbortSignal){
  const pr=await this.rawPr(input.url,signal);
  if(pr.head.sha!==input.expectedHead||pr.base.sha!==input.expectedBase)throw new GitHubReadError('ה־head או ה־base השתנו. קרא שוב את ה־PR לפני המשך הבדיקה.');
  return pr;
 }
 private async filePage(input:GitHubPinnedInput,signal?:AbortSignal){
  const args=githubPinnedSchema.parse(input);const pr=await this.pinned(args,signal);const ref=target(args.url,'pull');
  const files=githubFilesSchema.parse(await this.request(`${ref.endpoint}/pulls/${ref.number}/files?per_page=20&page=${args.page}`,signal));
  await this.pinned(args,signal);return {pr,files,args};
 }
 async files(input:GitHubPinnedInput,signal?:AbortSignal){
  const {pr,files,args}=await this.filePage(input,signal);
  return {...this.receipt(args.url),head:args.expectedHead,base:args.expectedBase,page:args.page,total:pr.changed_files,apiLimit:3000,complete:pr.changed_files<=20&&args.page===1&&files.length===pr.changed_files,
   ...(args.page*20<Math.min(pr.changed_files,3000)?{nextPage:args.page+1}:{}),apiTruncated:pr.changed_files>3000,
   files:files.map(file=>({filename:clean(file.filename,1000),status:file.status,additions:file.additions,deletions:file.deletions,patchAvailable:file.patch!==undefined&&readable(file.filename)&&(!file.previous_filename||readable(file.previous_filename))}))};
 }
 async patch(input:GitHubPatchInput,signal?:AbortSignal){
  const args=githubPatchSchema.parse(input);if(!readable(args.filename))throw new GitHubReadError('הקובץ מוגן או שהנתיב אינו תקין; תוכנו לא ייקרא.');
  const {files}=await this.filePage({url:args.url,expectedHead:args.expectedHead,expectedBase:args.expectedBase,page:args.page},signal);
  const file=files.find(file=>file.filename===args.filename);if(!file)throw new GitHubReadError('הקובץ לא נמצא בעמוד שנבחר. קרא קודם את רשימת הקבצים.');
  if(file.previous_filename&&!readable(file.previous_filename))throw new GitHubReadError('שם הקובץ הקודם מוגן; תוכנו לא ייקרא.');
  if(file.patch===undefined)return {...this.receipt(args.url),filename:args.filename,available:false,complete:false,note:'GitHub לא החזיר patch. אין להסיק שאין שינוי או שהקובץ נבדק.'};
  const patch=redactClaudeText(file.patch);if(args.offset>patch.length)throw new GitHubReadError('המיקום חורג מקטע ה־patch הזמין.');
  const end=args.offset+6000;
  return {...this.receipt(args.url),head:args.expectedHead,base:args.expectedBase,filename:args.filename,available:true,offset:args.offset,text:patch.slice(args.offset,end),...(end<patch.length?{nextOffset:end}:{}),complete:false,note:'קטע patch שסופק ב־GitHub, לא תוכן מלא של הקובץ ולא הוכחת כיסוי מלא. הטקסט עבר הסתרת סודות מוכרים.'};
 }
 async checks(input:GitHubPinnedInput,signal?:AbortSignal){
  const args=githubPinnedSchema.parse(input);await this.pinned(args,signal);const ref=target(args.url,'pull');
  const endpoint=`${ref.endpoint}/commits/${args.expectedHead}`;
  const [checks,statuses]=await Promise.all([this.request(`${endpoint}/check-runs?per_page=20&page=${args.page}`,signal).then(value=>githubChecksSchema.parse(value)),this.request(`${endpoint}/statuses?per_page=20&page=${args.page}`,signal).then(value=>githubStatusesSchema.parse(value))]);
  await this.pinned(args,signal);if(checks.check_runs.some(run=>run.head_sha!==args.expectedHead))throw new GitHubReadError('תוצאת בדיקה שייכת ל־SHA אחר.');
  return {...this.receipt(args.url),head:args.expectedHead,base:args.expectedBase,page:args.page,checkTotal:checks.total_count,
   checks:checks.check_runs.map(run=>({name:clean(run.name,200),status:run.status,conclusion:run.conclusion})),statuses:statuses.map(status=>({context:clean(status.context,200),state:status.state,description:clean(status.description??'',300)})),
   ...((checks.total_count>args.page*20||statuses.length===20)&&args.page<150?{nextPage:args.page+1}:{}),complete:false,note:'תוצאות CI וסטטוסים על commit בלבד; אין כאן אימות deploy או אישור merge.'};
 }
}

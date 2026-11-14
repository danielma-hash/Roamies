import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
// @ts-expect-error Existing app safety module is JavaScript.
import {checkRead,checkGitHubPrCreate,SAFE,ASK} from './safety.mjs';
import {redactClaudeText} from './claude-sessions.service.js';
import {GitHubReadError} from './github-read-error.js';
import {githubShaSchema,githubPrSchema} from './github-read.schema.js';
import {githubPrPrepareSchema,githubPrCreateSchema} from './github-pr.schema.js';
import type {GitHubPrInput,GitHubPrIntent,GitHubPrOptions,GitHubPrCommand} from './github-pr.types.js';
import type {GitHubPrStoreService} from './github-pr-store.service.js';
const exec=promisify(execFile);
const digest=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const remoteRef=z.object({object:z.object({sha:githubShaSchema})});
const listedPr=githubPrSchema.omit({merged:true,changed_files:true});
async function command(binary:string,args:readonly string[],options:{cwd?:string;input?:string;signal?:AbortSignal}):Promise<string>{
 try{const promise=exec(binary,[...args],{cwd:options.cwd,signal:options.signal,encoding:'utf8',timeout:20_000,maxBuffer:1_048_576,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});promise.child.stdin?.end(options.input);return (await promise).stdout;}
 catch{throw new GitHubReadError('פעולת GitHub או Git נכשלה או בוטלה. אין להסיק שהכתיבה לא בוצעה.');}
}
/** Exact preview approval, remote SHA recheck and durable intent before a single draft-PR POST. */
export class GitHubPrService {
 private readonly previews=new Map<string,{input:GitHubPrInput;expiresAt:number}>();
 private readonly run:GitHubPrCommand;
 private tail:Promise<unknown>=Promise.resolve();
 private failed=false;
 constructor(private readonly store:GitHubPrStoreService,private readonly options:GitHubPrOptions){this.run=options.command??command;}
 private api(repo:string,suffix:string,signal?:AbortSignal,input?:unknown):Promise<unknown>{
  const args=['api','--hostname','github.com','--method',input===undefined?'GET':'POST','--header','Accept: application/vnd.github+json',...(input===undefined?[]:['--input','-']),`repos/${repo}/${suffix}`];
  return this.run('gh',args,{signal,...(input===undefined?{}:{input:JSON.stringify(input)})}).then(text=>JSON.parse(text) as unknown);
 }
 private async validate(input:GitHubPrInput,signal?:AbortSignal):Promise<GitHubPrInput>{
  signal?.throwIfAborted();const cwd=await realpath(input.cwd);
  if(checkRead(cwd,homedir(),{recursive:true}).level!==SAFE)throw new GitHubReadError('תיקיית הפרויקט אינה מותרת.');
  const git=async(args:readonly string[])=> (await this.run('git',args,{cwd,signal})).trim();
  if(await realpath(await git(['rev-parse','--show-toplevel']))!==cwd)throw new GitHubReadError('נדרשת תיקיית השורש המדויקת של ה־worktree.');
  await git(['check-ref-format','--branch',input.head]);await git(['check-ref-format','--branch',input.base]);
  if(input.head===input.base||['main','master'].includes(input.head.toLowerCase()))throw new GitHubReadError('נדרש branch ייעודי לשינוי.');
  if(await git(['branch','--show-current'])!==input.head||await git(['rev-parse','HEAD'])!==input.expectedHead)throw new GitHubReadError('ה־branch או ה־SHA המקומיים אינם תואמים לבקשה.');
  if(await git(['status','--porcelain','--untracked-files=normal']))throw new GitHubReadError('יש שינויים לא שמורים ב־commit. יש להשלים אותם לפני הכנת PR.');
  const remote=await git(['remote','get-url',input.remote]);
  if(![`https://github.com/${input.repo}`,`https://github.com/${input.repo}.git`,`git@github.com:${input.repo}.git`,`git@github.com:${input.repo}`].some(url=>url.toLowerCase()===remote.toLowerCase()))throw new GitHubReadError('ה־remote אינו תואם ל־repo המדויק.');
  const policy=await this.options.policy(cwd,input.repo,signal);
  if(policy.governed)throw new GitHubReadError('הפרויקט כפוף למפעל: פתיחת PR מחייבת factory pr עם השער שלו. המסלול הכללי חסום.');
  const [head,base]=await Promise.all([this.api(input.repo,`git/ref/heads/${encodeURIComponent(input.head)}`,signal).then(remoteRef.parse),this.api(input.repo,`git/ref/heads/${encodeURIComponent(input.base)}`,signal).then(remoteRef.parse)]);
  if(head.object.sha!==input.expectedHead||base.object.sha!==input.expectedBase)throw new GitHubReadError('ה־head או ה־base ב־GitHub השתנו; יש להכין תצוגה חדשה.');
  signal?.throwIfAborted();return {...input,cwd};
 }
 async prepare(raw:unknown,signal?:AbortSignal){
  const input=githubPrPrepareSchema.parse(raw);
  if(redactClaudeText(input.title)!==input.title||redactClaudeText(input.body)!==input.body)throw new GitHubReadError('תוכן ה־PR כולל מידע שנראה רגיש. יש להסירו לפני הכנה.');
  const verified=await this.validate(input,signal);const now=Date.now();
  for(const [id,preview]of this.previews)if(preview.expiresAt<=now)this.previews.delete(id);
  if(this.previews.size>=20)throw new GitHubReadError('יש יותר מדי תצוגות ממתינות.');
  const previewId=randomUUID(),expiresAt=now+300_000;this.previews.set(previewId,{input:verified,expiresAt});
  return {previewId,expiresAt:new Date(expiresAt).toISOString(),draft:true,...verified,needsApproval:true,created:false};
 }
 create(raw:unknown,signal?:AbortSignal){
  const {previewId}=githubPrCreateSchema.parse(raw);
  const operation=this.tail.then(()=>this.createOne(previewId,signal));this.tail=operation.catch(()=>undefined);return operation;
 }
 private async existing(input:GitHubPrInput,signal?:AbortSignal){
  const query=new URLSearchParams({state:'all',head:`${input.repo.split('/')[0]}:${input.head}`,base:input.base,per_page:'100'});
  const prs=z.array(listedPr).max(100).parse(await this.api(input.repo,`pulls?${query}`,signal));
  if(prs.length>=100)throw new GitHubReadError('יותר מדי PRs תואמים; יש לברר בלי לבצע כתיבה נוספת.');
  for(const pr of prs){if(pr.head.ref!==input.head||pr.base.ref!==input.base||pr.html_url.toLowerCase()!==`https://github.com/${input.repo}/pull/${pr.number}`.toLowerCase())throw new GitHubReadError('זהות PR קיימת אינה תואמת.');}
  if(prs.length>1)throw new GitHubReadError('נמצאו כמה PRs לאותם branches; נדרש בירור.');return prs[0];
 }
 private receipt(input:GitHubPrInput,pr:z.infer<typeof listedPr>,created:boolean){
  const contentMatches=pr.title===input.title&&pr.body===input.body;
  return {url:pr.html_url,created,state:pr.state,draft:pr.draft,head:pr.head.sha,base:pr.base.sha,contentMatches,verified:pr.state==='open'&&pr.draft&&contentMatches&&pr.head.sha===input.expectedHead&&pr.base.sha===input.expectedBase,observedAt:new Date().toISOString(),deployment:'unknown',note:created?'טיוטת PR נוצרה; בדוק verified לפני טענה שהתוצאה תואמת.':'PR קיים נמצא. לא נוצר PR נוסף ולא שונה תוכנו.'};
 }
 private async save(intents:GitHubPrIntent[]):Promise<void>{try{await this.store.save(intents);}catch(error){this.failed=true;throw error;}}
 private async createOne(previewId:string,signal?:AbortSignal){
  const preview=this.previews.get(previewId);
  if(!preview||preview.expiresAt<=Date.now())throw new GitHubReadError('התצוגה פגה. יש להכין PR מחדש.');
  if(this.failed)throw new GitHubReadError('שמירת הכוונה נכשלה; נדרש בירור לפני כתיבה נוספת.');
  const input=await this.validate(preview.input,signal);
  if(checkGitHubPrCreate(input,{allowActions:this.options.allowed()}).level!==ASK)throw new GitHubReadError('פתיחת PR אינה מורשית כעת.');
  const key=digest([input.repo.toLowerCase(),input.head,input.base]);const intents=await this.store.load();
  const previous=intents.find(intent=>intent.key===key);const found=await this.existing(input,signal);
  if(found){if(previous){previous.state='created';previous.url=found.html_url;await this.save(intents);}return this.receipt(input,found,false);}
  if(previous)throw new GitHubReadError('קיימת כוונת פתיחה קודמת שטרם נמצאה ב־GitHub. אין לנסות שוב אוטומטית; נדרש בירור התוצאה.');
  if(intents.length>=200)throw new GitHubReadError('יומן כוונות ה־PR מלא. נדרש בירור לפני כתיבה נוספת.');
  const approval=`פתיחת טיוטת PR ב־${input.repo}\n${input.head} (${input.expectedHead}) → ${input.base} (${input.expectedBase})\n${input.title}\n\n${input.body}\n\nלאשר פתיחת טיוטה זו?`;
  if(!await this.options.confirm(approval,signal))throw new GitHubReadError('פתיחת PR בוטלה.');
  if(!this.options.allowed()||preview.expiresAt<=Date.now())throw new GitHubReadError('האישור אינו תקף עוד.');
  await this.validate(input,signal);const raced=await this.existing(input,signal);if(raced)return this.receipt(input,raced,false);
  if(!this.options.allowed())throw new GitHubReadError('ההרשאה בוטלה.');signal?.throwIfAborted();
  const intent:GitHubPrIntent={key,requestDigest:digest(input),state:'pending',createdAt:new Date().toISOString()};intents.push(intent);await this.save(intents);
  try{
   signal?.throwIfAborted();if(!this.options.allowed()||preview.expiresAt<=Date.now())throw new GitHubReadError('האישור בוטל לפני כתיבה.');
   const created=githubPrSchema.parse(await this.api(input.repo,'pulls',signal,{head:input.head,base:input.base,title:input.title,body:input.body,draft:true}));
   if(created.html_url.toLowerCase()!==`https://github.com/${input.repo}/pull/${created.number}`.toLowerCase()||created.head.ref!==input.head||created.base.ref!==input.base)throw new GitHubReadError('תוצאת פתיחת PR אינה תואמת.');
   intent.state='created';intent.url=created.html_url;await this.save(intents);
   const observed=githubPrSchema.parse(await this.api(input.repo,`pulls/${created.number}`,signal));
   if(observed.html_url!==created.html_url||observed.head.ref!==input.head||observed.base.ref!==input.base)throw new GitHubReadError('אימות PR אינו תואם ליעד.');
   return this.receipt(input,observed,true);
  }catch{
   intent.state='unknown';await this.save(intents);
   // The request may have succeeded. Observe once, never POST again.
   const reconciled=await this.existing(input).catch(()=>undefined);
   if(reconciled){intent.state='created';intent.url=reconciled.html_url;await this.save(intents);return {...this.receipt(input,reconciled,false),reconciled:true};}
   throw new GitHubReadError('תוצאת פתיחת ה־PR אינה ידועה. הכוונה נשמרה, ולא תישלח שוב בלי בירור.');
  }
 }
}

import {afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,realpath,rm,readFile,writeFile,stat,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {GitHubPrService} from '../github-pr.service.js';
import {GitHubPrStoreService} from '../github-pr-store.service.js';
import type {GitHubPrCommand,GitHubPrOptions} from '../github-pr.types.js';
const roots:string[]=[];const head='a'.repeat(40),base='b'.repeat(40);
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(){
 const root=await realpath(await mkdtemp('/tmp/roamies-pr-'));roots.push(root);const file=join(root,'intents.json');const store=new GitHubPrStoreService(file);
 const input={cwd:root,repo:'example/project',remote:'fork',head:'feat/fixture',base:'main',expectedHead:head,expectedBase:base,title:'בדיקת PR',body:'תיקון בדיקה עם אימות.'};
 const state={allowed:true,governed:false,dirty:false,remoteHead:head,readbackHead:head,postFails:false,createdBeforeFailure:false,readsFail:false,posts:0,existing:[] as unknown[],confirmed:[] as string[],afterConfirm:()=>{}};
 const response=()=>({html_url:'https://github.com/example/project/pull/9',number:9,title:input.title,body:input.body,state:'open',draft:true,merged:false,head:{sha:state.remoteHead,ref:input.head},base:{sha:base,ref:input.base},changed_files:1,updated_at:'2026-11-14T10:00:00Z'});
 const command:GitHubPrCommand=async(binary,args,options)=>{
  if(binary==='git'){
   if(args[0]==='check-ref-format')return args[2]??'';
   if(args[0]==='rev-parse')return args[1]==='HEAD'?head:root;
   if(args[0]==='branch')return input.head;
   if(args[0]==='status')return state.dirty?' M file.txt':'';
   if(args[0]==='remote')return 'https://github.com/example/project.git';throw new Error('unexpected git');
  }
  expect(binary).toBe('gh');expect(args.slice(0,3)).toEqual(['api','--hostname','github.com']);
  const endpoint=args.at(-1)!;
  if(args.includes('POST')){
   state.posts++;expect(JSON.parse(await readFile(file,'utf8')).intents[0].state).toBe('pending');expect(JSON.parse(options.input!)).toMatchObject({draft:true,title:input.title,head:input.head,base:input.base});
   if(!state.postFails||state.createdBeforeFailure)state.existing=[response()];if(state.postFails)throw new Error('ambiguous timeout');return JSON.stringify(response());
  }
  if(state.readsFail)throw new Error('auth failed');
  if(endpoint.includes('/git/ref/heads/'))return JSON.stringify({object:{sha:endpoint.endsWith('/main')?base:state.remoteHead}});
  if(endpoint.includes('/pulls?'))return JSON.stringify(state.existing);
  if(endpoint.endsWith('/pulls/9'))return JSON.stringify({...response(),head:{sha:state.readbackHead,ref:input.head}});throw new Error('unexpected endpoint '+endpoint);
 };
 const options:GitHubPrOptions={allowed:()=>state.allowed,confirm:async(text)=>{state.confirmed.push(text);state.afterConfirm();return true;},policy:async()=>({governed:state.governed,protectedBranches:[]}),command};
 const service=new GitHubPrService(store,options);return {root,file,store,input,state,options,service,response};
}
it('creates only the approved draft, checkpoints before POST and reads back the result',async()=>{
 const f=await fixture();const prepared=await f.service.prepare(f.input);expect(f.state.posts).toBe(0);const result=await f.service.create({previewId:prepared.previewId});
 expect(result).toMatchObject({created:true,verified:true,draft:true,head,base,deployment:'unknown'});expect(f.state.posts).toBe(1);expect(f.state.confirmed[0]).toContain(f.input.body);expect(f.state.confirmed[0]).toContain(head);expect((await stat(f.file)).mode&0o777).toBe(0o600);
 const stored=await readFile(f.file,'utf8');expect(stored).not.toContain(f.input.body);expect(JSON.parse(stored).intents[0].state).toBe('created');
});
it('serializes duplicate requests and observes the existing PR instead of posting twice',async()=>{
 const f=await fixture();const p=await f.service.prepare(f.input);const results=await Promise.all([f.service.create({previewId:p.previewId}),f.service.create({previewId:p.previewId})]);expect(results.map(r=>r.created)).toEqual([true,false]);expect(f.state.posts).toBe(1);expect(f.state.confirmed).toHaveLength(1);
});
it('does not mark a created PR verified if its remote head moved before readback',async()=>{
 const f=await fixture();f.state.readbackHead='c'.repeat(40);const p=await f.service.prepare(f.input);expect(await f.service.create({previewId:p.previewId})).toMatchObject({created:true,verified:false,head:'c'.repeat(40)});expect(f.state.posts).toBe(1);
});
it('matches GitHub repository identity case-insensitively without accepting another repository',async()=>{
 const f=await fixture();const p=await f.service.prepare({...f.input,repo:'Example/Project'});expect(await f.service.create({previewId:p.previewId})).toMatchObject({created:true,verified:true});
});
it('does not POST when the durable intent cannot be saved',async()=>{
 const f=await fixture();vi.spyOn(f.store,'save').mockRejectedValue(new Error('disk full'));const p=await f.service.prepare(f.input);await expect(f.service.create({previewId:p.previewId})).rejects.toThrow('disk full');expect(f.state.posts).toBe(0);await expect(f.service.create({previewId:p.previewId})).rejects.toThrow('שמירת הכוונה');
});
it('blocks a governed repo and fails closed if policy cannot be read',async()=>{
 const f=await fixture();f.state.governed=true;await expect(f.service.prepare(f.input)).rejects.toThrow('factory pr');expect(f.state.posts).toBe(0);
 const service=new GitHubPrService(f.store,{...f.options,policy:async()=>{throw new Error('policy unavailable');}});await expect(service.prepare(f.input)).rejects.toThrow('unavailable');
});
it('rechecks policy, SHA, action setting and cancellation after approval',async()=>{
 for(const mode of ['policy','sha','permission','abort']){
  const f=await fixture();const controller=new AbortController();const p=await f.service.prepare(f.input);
  f.state.afterConfirm=()=>{if(mode==='policy')f.state.governed=true;else if(mode==='sha')f.state.remoteHead='c'.repeat(40);else if(mode==='permission')f.state.allowed=false;else controller.abort();};
  await expect(f.service.create({previewId:p.previewId},controller.signal)).rejects.toThrow();expect(f.state.posts).toBe(0);
 }
});
it('does not create when approval is denied or actions are disabled',async()=>{
 const f=await fixture();const service=new GitHubPrService(f.store,{...f.options,confirm:async()=>false});const p=await service.prepare(f.input);await expect(service.create({previewId:p.previewId})).rejects.toThrow('בוטלה');
 f.state.allowed=false;const p2=await f.service.prepare(f.input);await expect(f.service.create({previewId:p2.previewId})).rejects.toThrow('מורשית');expect(f.state.posts).toBe(0);
});
it('reconciles a successful POST whose response timed out without a second POST',async()=>{
 const f=await fixture();f.state.postFails=true;f.state.createdBeforeFailure=true;const p=await f.service.prepare(f.input);
 expect(await f.service.create({previewId:p.previewId})).toMatchObject({created:false,reconciled:true,verified:true});expect(f.state.posts).toBe(1);expect((await f.store.load())[0]?.state).toBe('created');
});
it('persists an unknown outcome across restart and refuses an automatic retry while absent',async()=>{
 const f=await fixture();f.state.postFails=true;const p=await f.service.prepare(f.input);await expect(f.service.create({previewId:p.previewId})).rejects.toThrow('אינה ידועה');expect((await f.store.load())[0]?.state).toBe('unknown');
 const recovered=new GitHubPrService(new GitHubPrStoreService(f.file),f.options);const p2=await recovered.prepare(f.input);await expect(recovered.create({previewId:p2.previewId})).rejects.toThrow('כוונת פתיחה קודמת');expect(f.state.posts).toBe(1);
 f.state.existing=[f.response()];expect(await recovered.create({previewId:p2.previewId})).toMatchObject({created:false,verified:true});expect(f.state.posts).toBe(1);
});
it('refuses expired previews, dirty worktrees, mismatched branches and known secret content',async()=>{
 const f=await fixture();f.state.dirty=true;await expect(f.service.prepare(f.input)).rejects.toThrow('שינויים');f.state.dirty=false;
 await expect(f.service.prepare({...f.input,head:'another'})).rejects.toThrow('המקומיים');await expect(f.service.prepare({...f.input,body:'API_TOKEN=private-value'})).rejects.toThrow('רגיש');
 const p=await f.service.prepare(f.input);vi.spyOn(Date,'now').mockReturnValue(Date.now()+300001);await expect(f.service.create({previewId:p.previewId})).rejects.toThrow('פגה');expect(f.state.posts).toBe(0);
});
it('does not overwrite a corrupt or symlinked intent journal or create a PR',async()=>{
 const f=await fixture();await writeFile(f.file,'broken');const p=await f.service.prepare(f.input);await expect(f.service.create({previewId:p.previewId})).rejects.toThrow('יומן');expect(await readFile(f.file,'utf8')).toBe('broken');expect(f.state.posts).toBe(0);
 const target=join(f.root,'linked.json');await symlink(f.file,target);await expect(new GitHubPrStoreService(target).load()).rejects.toThrow('יומן');
});
it('reports an existing PR without modifying a different body or claiming requested content was verified',async()=>{
 const f=await fixture();f.state.existing=[{...f.response(),body:'previous contents'}];const p=await f.service.prepare(f.input);expect(await f.service.create({previewId:p.previewId})).toMatchObject({created:false,verified:false,contentMatches:false});expect(f.state.posts).toBe(0);expect(f.state.confirmed).toHaveLength(0);
});

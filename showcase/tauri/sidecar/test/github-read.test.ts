import {describe,it,expect,vi} from 'vitest';
import {GitHubReadService} from '../github-read.service.js';
import {createGitHubReadTools} from '../github-read-tools.js';
import {CapabilityRegistry} from '../capability-registry.js';
const url='https://github.com/example/project/pull/12';
const head='a'.repeat(40),base='b'.repeat(40);
const pr=()=>({html_url:url,number:12,title:'בדיקה',body:'תוכן',state:'open',draft:true,merged:false,head:{sha:head,ref:'feat/test'},base:{sha:base,ref:'main'},changed_files:1,updated_at:'2026-11-14T09:00:00Z'});
const file=(patch='@@ -1 +1 @@\n-old\n+חדש')=>({filename:'src/main.ts',status:'modified',additions:1,deletions:1,changes:2,patch});
const pinned={url,expectedHead:head,expectedBase:base};
describe('bounded GitHub reads',()=>{
 it('rejects hostile URL shapes and wrong resource kinds before the API',async()=>{
  const request=vi.fn();const service=new GitHubReadService(request);
  for(const value of ['https://github.com/../project/pull/1','https://github.com/example/../pull/1',url+'?x=1',url+'#files','https://github.com@evil.test/example/project/pull/12','https://evil.test/example/project/pull/12','https://github.com/example/project/pull/12/merge',url.replace('/pull/','/issues/'),'https://github.com/example/project/pull/0'])await expect(service.pr({url:value})).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
 });
 it('returns a bounded redacted PR summary with provenance, without equating CI or merge to deploy',async()=>{
  const service=new GitHubReadService(async()=>({...pr(),body:'API_TOKEN=private-value\n'+'א'.repeat(5000)}));
  const result=await service.pr({url});expect(result.body).not.toContain('private-value');expect(result.body.length).toBeLessThanOrEqual(4000);
  expect(result).toMatchObject({source:url,head:{sha:head},base:{sha:base},deployment:'unknown',bodyTruncated:true,untrustedContent:true});
 });
 it('refuses redirected repository identity and propagates unavailable/auth errors',async()=>{
  await expect(new GitHubReadService(async()=>({...pr(),html_url:url.replace('example','other')})).pr({url})).rejects.toThrow('זהות');
  await expect(new GitHubReadService(async()=>{throw new Error('401 fixture');}).pr({url})).rejects.toThrow('401');
 });
 it('reads issues separately and never treats PR data as an issue',async()=>{
  const issueUrl=url.replace('/pull/','/issues/');const issue={html_url:issueUrl,number:12,title:'Issue',body:null,state:'open',updated_at:pr().updated_at,labels:[{name:'bug'}]};
  const result=await new GitHubReadService(async()=>issue).issue({url:issueUrl});expect(result.labels).toEqual(['bug']);expect(result.body).toBe('');
  await expect(new GitHubReadService(async()=>({...issue,pull_request:{}})).issue({url:issueUrl})).rejects.toThrow('PR');
 });
 it('paginates metadata without leaking patches and reports the GitHub 3000-file ceiling',async()=>{
  const request=vi.fn(async(endpoint:string)=>endpoint.includes('/files?')?[file('SECRET CONTENT')]:({...pr(),changed_files:3001}));
  const result=await new GitHubReadService(request).files(pinned);
  expect(result).toMatchObject({page:1,nextPage:2,total:3001,apiLimit:3000,apiTruncated:true,complete:false});expect(JSON.stringify(result)).not.toContain('SECRET CONTENT');
  expect(request.mock.calls[1]?.[0]).toBe('repos/example/project/pulls/12/files?per_page=20&page=1');
 });
 it('rejects SHA drift before loading a page and after the response, including base movement',async()=>{
  const before=vi.fn(async()=>({...pr(),head:{...pr().head,sha:'c'.repeat(40)}}));await expect(new GitHubReadService(before).files(pinned)).rejects.toThrow('השתנו');expect(before).toHaveBeenCalledTimes(1);
  let reads=0;const after=async(endpoint:string)=>endpoint.includes('/files?')?[file()]:++reads===1?pr():({...pr(),base:{...pr().base,sha:'c'.repeat(40)}});
  await expect(new GitHubReadService(after).patch({...pinned,filename:'src/main.ts'})).rejects.toThrow('השתנו');
 });
 it('blocks protected and traversal filenames before fetching, and protected rename sources',async()=>{
  const request=vi.fn();const service=new GitHubReadService(request);
  for(const filename of ['.env','nested/.env.production','../secret.txt','/etc/passwd','.ssh/id_rsa','dir\\file'])await expect(service.patch({...pinned,filename})).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  const renamed=new GitHubReadService(async(endpoint)=>endpoint.includes('/files?')?[{...file(),previous_filename:'.env'}]:pr());
  expect((await renamed.files(pinned)).files[0]?.patchAvailable).toBe(false);await expect(renamed.patch({...pinned,filename:'src/main.ts'})).rejects.toThrow('הקודם מוגן');
 });
 it('redacts before slicing a patch, bounds fragments and never claims complete coverage',async()=>{
  const service=new GitHubReadService(async(endpoint)=>endpoint.includes('/files?')?[file('TOKEN=secret-text\n'+'x'.repeat(9000))]:pr());
  const first=await service.patch({...pinned,filename:'src/main.ts'});expect(first).toMatchObject({available:true,nextOffset:6000,complete:false});expect('text'in first&&first.text?.length).toBe(6000);expect(JSON.stringify(first)).not.toContain('secret-text');
  const second=await service.patch({...pinned,filename:'src/main.ts',offset:6000});expect(second).not.toHaveProperty('nextOffset');expect(second.complete).toBe(false);
  await expect(service.patch({...pinned,filename:'src/main.ts',offset:999999})).rejects.toThrow('חורג');
 });
 it('reports omitted binary/large patches as unavailable instead of an empty successful review',async()=>{
  const {patch:_patch,...without}=file();const service=new GitHubReadService(async(endpoint)=>endpoint.includes('/files?')?[without]:pr());
  expect(await service.patch({...pinned,filename:'src/main.ts'})).toMatchObject({available:false,complete:false});
  await expect(service.patch({...pinned,filename:'missing.ts'})).rejects.toThrow('לא נמצא');
 });
 it('pins check runs to their commit, returns separate statuses and bounds pagination',async()=>{
  const request=vi.fn(async(endpoint:string)=>endpoint.includes('/check-runs?')?{total_count:21,check_runs:[{name:'CI',head_sha:head,status:'completed',conclusion:'success'}]}:endpoint.includes('/statuses?')?[{context:'build',state:'success',description:'Passed'}]:pr());
  const result=await new GitHubReadService(request).checks(pinned);expect(result).toMatchObject({head,nextPage:2,deployment:'unknown',complete:false});expect(result.checks[0]?.conclusion).toBe('success');
  expect(request.mock.calls.some(([path])=>path.includes(`/commits/${head}/check-runs?`))).toBe(true);
  const wrong=new GitHubReadService(async(endpoint)=>endpoint.includes('/check-runs?')?{total_count:1,check_runs:[{name:'CI',head_sha:base,status:'completed',conclusion:'success'}]}:endpoint.includes('/statuses?')?[]:pr());await expect(wrong.checks(pinned)).rejects.toThrow('SHA אחר');
 });
 it('validates page bounds and external response size and propagates cancellation signal',async()=>{
  const request=vi.fn(async()=>pr());const service=new GitHubReadService(request);
  await expect(service.files({...pinned,page:151})).rejects.toThrow();expect(request).not.toHaveBeenCalled();
  const signal=new AbortController().signal;await service.pr({url},signal);expect(request).toHaveBeenCalledWith('repos/example/project/pulls/12',signal);
  await expect(new GitHubReadService(async(endpoint)=>endpoint.includes('/files?')?Array.from({length:21},()=>file()):pr()).files(pinned)).rejects.toThrow();
 });
 it('loads read-only GitHub tools lazily without enabling actions',async()=>{
  const tools=createGitHubReadTools(new GitHubReadService(async()=>pr()));const catalog=new CapabilityRegistry([...tools],()=>false).forAgent();
  expect(catalog.tools.map(tool=>tool.name)).toEqual(['discover_capabilities']);
  const result=await catalog.tools[0]!.execute({family:'github'},{signal:new AbortController().signal,toolCallId:'fixture'}) as {content:string};expect(JSON.parse(result.content).actionsSettingEnabled).toBe(false);
  expect(catalog.tools.map(tool=>tool.name)).toContain('github_pr_patch');expect(tools.some(tool=>/write|merge|create/.test(tool.name))).toBe(false);
 });
});

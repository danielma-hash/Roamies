import {expect,it,vi} from 'vitest';
import {LiveQueryProviderService} from '../live-query-provider.service.js';
const signal=new AbortController().signal;
const sessions={list:async()=>({available:true,sessions:[{id:'same',title:'history',cwd:'/fixture',branch:'main',updatedAt:1,status:'unknown' as const},{id:'other',title:'other',cwd:'/fixture',branch:'main',updatedAt:1,status:'waiting' as const}]})};
const runs={list:()=>[{id:'same',title:'managed',cwd:'/fixture',state:'running' as const,queued:0,lastReply:'never include this transcript'}]};
const attention={snapshot:async()=>({preferences:{quiet:false,focus:false},unread:1,events:[{id:'1',sourceId:'s',kind:'session-waiting' as const,title:'ממתין',createdAt:1},{id:'2',sourceId:'s',kind:'session-ended' as const,title:'read',createdAt:1,dismissedAt:2}]})};
it('uses managed state over matching history and never includes transcripts',async()=>{
 const provider=new LiveQueryProviderService(sessions,runs,{list:()=>[],read:vi.fn()},attention);
 const table=await provider.read('sessions','',signal);expect(table.rowIds).toEqual(['same','other']);expect(table.rows[0]).toEqual(['managed','פועל','מנוהל']);expect(JSON.stringify(table)).not.toContain('transcript');
 expect((await provider.read('attention','',signal)).rowIds).toEqual(['1']);
});
it('reads at most five tracked PRs, carries cancellation, and does not imply deploy',async()=>{
 const cards=Array.from({length:8},(_,i)=>({title:`PR ${i}`,url:`https://github.com/team/repo/pull/${i+1}`,state:'OPEN' as const,headRefName:'fixture',headRefOid:'abc',statusCheckRollup:[],observedAt:1,deployment:'unknown' as const}));
 const read=vi.fn(async(url:string)=>cards.find(card=>card.url===url)!);const provider=new LiveQueryProviderService(sessions,runs,{list:()=>cards,read},attention);
 const table=await provider.read('prs','',signal);expect(table.rows).toHaveLength(5);expect(read).toHaveBeenCalledTimes(5);expect(read).toHaveBeenNthCalledWith(1,cards[0]!.url,undefined,signal);expect(table.columns).not.toContain('פריסה');
});
it('does not invoke a source after cancellation',async()=>{
 const list=vi.fn();const provider=new LiveQueryProviderService({list},runs,{list:()=>[],read:vi.fn()},attention);
 await expect(provider.read('sessions','',AbortSignal.abort())).rejects.toThrow();expect(list).not.toHaveBeenCalled();
});

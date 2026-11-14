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
it('shows persisted task progress without equating returned calls with verified success',async()=>{
 const tasks={initialize:async()=>{},flush:async()=>{},list:()=>[
  {id:'older',request:'בדיקת תור',hasImage:false,status:'returned' as const,verified:false as const,createdAt:1,updatedAt:1,tools:[{id:'a',name:'read',argsDigest:'a'.repeat(64),status:'returned' as const}]},
  {id:'newer',request:'בדיקת ניתוק',hasImage:false,status:'interrupted' as const,verified:false as const,createdAt:1,updatedAt:2,tools:[{id:'b',name:'write',argsDigest:'b'.repeat(64),status:'unknown' as const}]},
 ]};
 const provider=new LiveQueryProviderService(sessions,runs,{list:()=>[],read:vi.fn()},attention,tasks);
 const table=await provider.read('tasks','בדיקת',signal);
 expect(table.rowIds).toEqual(['newer','older']);expect(table.rows[0]?.slice(1,4)).toEqual(['נקטעה','0/1 חזרו','כן']);
 expect(table.rows[1]?.[1]).toBe('התקבלה תשובה');expect(table.source).toContain('אינה אימות');
 expect(JSON.stringify(table)).not.toContain('argsDigest');expect((await provider.read('tasks','תור',signal)).rowIds).toEqual(['older']);
});
it('surfaces unavailable/corrupt task storage rather than an empty success table',async()=>{
 const absent=new LiveQueryProviderService(sessions,runs,{list:()=>[],read:vi.fn()},attention);
 await expect(absent.read('tasks','',signal)).rejects.toThrow('אינו מחובר');
 const list=vi.fn(()=>[]);const corrupt=new LiveQueryProviderService(sessions,runs,{list:()=>[],read:vi.fn()},attention,{list,initialize:async()=>{},flush:async()=>{throw new Error('storage');}});
 await expect(corrupt.read('tasks','',signal)).rejects.toThrow('storage');expect(list).not.toHaveBeenCalled();
});

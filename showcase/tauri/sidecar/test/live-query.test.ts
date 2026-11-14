import {afterEach,expect,it,vi} from 'vitest';
import {LiveQueryService} from '../live-query.service.js';
import type {LiveQueryMessage,LiveQueryTable} from '../live-query.types.js';
import type {LivePanelEnvelope} from '../live-panel.types.js';
const panel:LivePanelEnvelope={id:'12345678-1234-4567-8901-123456789abc',revision:1,createdAt:'2026-11-14T08:00:00Z',spec:{title:'חי',blocks:[{kind:'query',id:'sessions',title:'סשנים',source:'sessions'}]}};
const table=():LiveQueryTable=>({columns:['שם'],rows:[['בדיקה']],rowIds:['id'],observedAt:Date.now(),source:'fixture'});
afterEach(()=>vi.useRealTimers());
it('replays paused state after the restored panel mounts without reading its source',async()=>{
 vi.useFakeTimers();const read=vi.fn(async()=>table());const messages:LiveQueryMessage[]=[];
 const service=new LiveQueryService(read,m=>messages.push(m),()=>false);
 service.activate(panel,false);messages.length=0; // initial event arrived before the WebView mounted
 service.activate(panel,true);expect(messages).toHaveLength(1);expect(messages[0]).toMatchObject({status:'paused',panelId:panel.id});
 expect(messages[0]?.table).toBeUndefined();await vi.advanceTimersByTimeAsync(60_000);expect(read).not.toHaveBeenCalled();service.close();
});
it('polls without model calls only while visible, with a source-wide minimum interval',async()=>{
 vi.useFakeTimers();const read=vi.fn(async()=>table());const messages:LiveQueryMessage[]=[];const service=new LiveQueryService(read,m=>messages.push(m),()=>true);
 service.activate(panel,false);await vi.advanceTimersByTimeAsync(60_000);expect(read).not.toHaveBeenCalled();
 service.activate(panel,true);await vi.advanceTimersByTimeAsync(0);expect(read).toHaveBeenCalledTimes(1);expect(messages.at(-1)?.status).toBe('ready');
 service.activate(panel,false);service.activate({...panel,revision:2},true);await vi.advanceTimersByTimeAsync(29_999);expect(read).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);expect(read).toHaveBeenCalledTimes(2);service.close();await vi.advanceTimersByTimeAsync(60_000);expect(read).toHaveBeenCalledTimes(2);
});
it('drops a late result after permission is revoked and clears data on pause',async()=>{
 vi.useFakeTimers();let allowed=true;let resolve:(value:LiveQueryTable)=>void=()=>{};let signal:AbortSignal|undefined;const messages:LiveQueryMessage[]=[];
 const service=new LiveQueryService(async(_s,_q,s)=>{signal=s;return new Promise(r=>{resolve=r;});},m=>messages.push(m),()=>allowed);
 service.activate(panel,true);await vi.advanceTimersByTimeAsync(0);allowed=false;service.activate(panel,true);resolve(table());await vi.advanceTimersByTimeAsync(0);
 expect(signal?.aborted).toBe(true);expect(messages.at(-1)).toMatchObject({status:'paused'});expect(messages.at(-1)?.table).toBeUndefined();expect(messages.some(m=>m.status==='ready')).toBe(false);service.close();
});
it('keeps the previous timestamp as stale on failure and times out a stuck provider',async()=>{
 vi.useFakeTimers();let count=0;const messages:LiveQueryMessage[]=[];const service=new LiveQueryService(async()=>{if(++count===1)return table();return new Promise(()=>{});},m=>messages.push(m),()=>true);
 service.activate(panel,true);await vi.advanceTimersByTimeAsync(0);const observed=messages.at(-1)?.table?.observedAt;
 await vi.advanceTimersByTimeAsync(52_000);expect(messages.at(-1)).toMatchObject({status:'stale',table:{observedAt:observed}});service.close();
});
it('rejects malformed oversized output rather than publishing it',async()=>{
 vi.useFakeTimers();const messages:LiveQueryMessage[]=[];const service=new LiveQueryService(async()=>({...table(),rows:[['x'.repeat(201)]]}),m=>messages.push(m),()=>true);
 service.activate(panel,true);await vi.advanceTimersByTimeAsync(0);expect(messages.at(-1)?.status).toBe('error');expect(messages.some(m=>m.status==='ready')).toBe(false);service.close();
});
it('refreshes local task progress every three seconds and stops when the panel is hidden',async()=>{
 vi.useFakeTimers();const read=vi.fn(async()=>table());const service=new LiveQueryService(read,()=>{},()=>true);
 const tasks:LivePanelEnvelope={...panel,spec:{title:'משימות',blocks:[{kind:'query',id:'tasks',title:'התקדמות',source:'tasks'}]}};
 service.activate(tasks,true);await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(3000);expect(read).toHaveBeenCalledTimes(2);
 expect(read).toHaveBeenLastCalledWith('tasks','',expect.any(AbortSignal));service.activate(tasks,false);await vi.advanceTimersByTimeAsync(30_000);expect(read).toHaveBeenCalledTimes(2);service.close();
});

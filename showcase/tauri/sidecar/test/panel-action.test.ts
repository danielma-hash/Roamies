import {afterEach,expect,it,vi} from 'vitest';
import {PanelActionService} from '../panel-action.service.js';
import type {LivePanelEnvelope} from '../live-panel.types.js';
import type {LiveQueryMessage} from '../live-query.types.js';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const panel:LivePanelEnvelope={id:'12345678-1234-4567-8901-123456789abc',revision:1,createdAt:'2026-11-14T08:00:00Z',spec:{title:'חי',blocks:[{kind:'query',id:'q',title:'סשנים',source:'sessions'}]}};
const message:LiveQueryMessage={kind:'live_query',panelId:panel.id,revision:1,blockId:'q',status:'ready',table:{columns:['סשן'],rows:[['one'],['two'],['three']],rowIds:ids,source:'fixture',observedAt:Date.now()}};
afterEach(()=>vi.useRealTimers());
it('uses the acknowledged filtered order and binds identity before an asynchronous action',async()=>{
 let finish:()=>void=()=>{};const execute=vi.fn(async(_action,id)=>{await new Promise<void>(resolve=>{finish=resolve;});return JSON.stringify({id,accepted:true});});
 const service=new PanelActionService(()=>panel,()=>true,()=>['stop'],execute);const bound=service.decorate(message).binding!;
 expect(service.context().available).toBe(false);expect(service.acknowledge(bound.viewId,[bound.rows[0]!.ref,bound.rows[2]!.ref])).toBe(true);
 const context=service.context();expect(context.available).toBe(true);if(!context.available)throw new Error('context');expect(context.rows[1]?.title).toBe('three');
 const input={ref:context.rows[1]!.ref,action:'stop' as const};const first=service.act(input);const duplicate=service.act(input);await Promise.resolve();
 service.decorate({...message,table:{...message.table!,rows:[['three'],['two'],['one']],rowIds:[ids[2]!,ids[1]!,ids[0]!]}});finish();
 expect(JSON.parse(await first).id).toBe(ids[2]);expect(await duplicate).toBe(await first);expect(execute).toHaveBeenCalledTimes(1);
});
it('rejects stale, invented, hidden and differently retried references',async()=>{
 vi.useFakeTimers();const execute=vi.fn(async()=>'{"accepted":true}');const service=new PanelActionService(()=>panel,()=>true,()=>['send'],execute);
 const binding=service.decorate(message).binding!;expect(service.acknowledge(binding.viewId,[ids[0]])).toBe(false);service.acknowledge(binding.viewId,[binding.rows[0]!.ref]);
 expect(()=>service.act({ref:binding.rows[1]!.ref,action:'send',instruction:'hidden'})).toThrow();
 await service.act({ref:binding.rows[0]!.ref,action:'send',instruction:'same'});expect(()=>service.act({ref:binding.rows[0]!.ref,action:'send',instruction:'changed'})).toThrow();
 await vi.advanceTimersByTimeAsync(120001);expect(service.context().available).toBe(false);expect(execute).toHaveBeenCalledTimes(1);
});
it('requires the current panel and permission, and invalidates failed data',()=>{
 let enabled=true;let current=panel;const service=new PanelActionService(()=>current,()=>enabled,()=>['stop'],vi.fn());const binding=service.decorate(message).binding!;service.acknowledge(binding.viewId,[binding.rows[0]!.ref]);
 enabled=false;expect(service.context().available).toBe(false);enabled=true;current={...panel,revision:2};expect(service.context().available).toBe(false);current=panel;
 service.decorate({...message,status:'stale'});expect(service.context().available).toBe(false);
});

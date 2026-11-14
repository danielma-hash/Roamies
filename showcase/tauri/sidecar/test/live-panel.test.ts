import { expect,it,vi } from 'vitest';
import { z } from 'zod';
import { livePanelSpecSchema } from '../live-panel.schema.js';
import { LivePanelService } from '../live-panel.service.js';
import { createLivePanelTool } from '../live-panel-tool.js';
const spec={title:'השוואה',blocks:[{id:'table',kind:'table',title:'נתונים',columns:['שם','ערך'],rows:[['עברית English',12]]}]};
it('validates the closed catalog and provides a provider-compatible JSON schema',()=>{
 expect(livePanelSpecSchema.parse(spec).title).toBe('השוואה');expect(z.toJSONSchema(livePanelSpecSchema)).toMatchObject({type:'object'});
 for(const extra of [{html:'<script>'},{script:'alert(1)'},{css:'body{}'},{url:'https://example.com'}])expect(livePanelSpecSchema.safeParse({...spec,...extra}).success).toBe(false);
 expect(livePanelSpecSchema.safeParse({...spec,blocks:[{kind:'iframe',id:'x',title:'bad',url:'https://example.com'}]}).success).toBe(false);
});
it('rejects inconsistent tables, oversized data, duplicate IDs and missing flow endpoints',()=>{
 expect(livePanelSpecSchema.safeParse({...spec,blocks:[{...spec.blocks[0],rows:[['one']]}]}).success).toBe(false);
 expect(livePanelSpecSchema.safeParse({...spec,blocks:[spec.blocks[0],spec.blocks[0]]}).success).toBe(false);
 expect(livePanelSpecSchema.safeParse({...spec,blocks:[{kind:'flow',id:'f',title:'flow',nodes:[{id:'a',title:'A'}],edges:[{from:'a',to:'missing'}]}]}).success).toBe(false);
 const rows=Array.from({length:60},()=>Array.from({length:8},()=> 'א'.repeat(500)));
 expect(livePanelSpecSchema.safeParse({...spec,blocks:[{...spec.blocks[0],columns:Array(8).fill('c'),rows}]}).success).toBe(false);
});
it('rejects invalid select values and non-finite chart data',()=>{
 expect(livePanelSpecSchema.safeParse({title:'form',blocks:[{kind:'form',id:'f',title:'form',fields:[{id:'choice',kind:'select',label:'בחירה',options:['A'],value:'B'}]}]}).success).toBe(false);
 expect(livePanelSpecSchema.safeParse({title:'chart',blocks:[{kind:'bar',id:'b',title:'chart',points:[{label:'bad',value:Infinity}]}]}).success).toBe(false);
});
it('does not expose mutable service state or claim display verification from a send receipt',async()=>{
 const service=new LivePanelService();let shown=0;const tool=createLivePanelTool(service,()=>{shown++;});
 vi.useFakeTimers(); const pending=tool.execute(livePanelSpecSchema.parse(spec));await vi.advanceTimersByTimeAsync(5000);const result=JSON.parse(await pending);vi.useRealTimers();expect(result).toMatchObject({displayRequested:true,verified:false,revision:1});expect(shown).toBe(1);
 const snapshot=service.snapshot()!;snapshot.spec.title='mutated';expect(service.snapshot()?.spec.title).toBe('השוואה');
});

it('accepts only a receipt for the current panel revision and cancels waits when replaced',async()=>{
 const service=new LivePanelService();expect(service.markRendered(undefined,undefined)).toBe(false);const first=await service.show(spec);const waiting=service.waitForRender(first.id);
 expect(service.markRendered(first.id,2)).toBe(false);const next=await service.show(spec);expect(await waiting).toBe(false);
 expect(service.markRendered(first.id,1)).toBe(false);expect(await service.waitForRender(next.id,undefined,2)).toBe(false);const current=service.waitForRender(next.id);expect(service.markRendered(next.id,1)).toBe(true);expect(await current).toBe(true);
});

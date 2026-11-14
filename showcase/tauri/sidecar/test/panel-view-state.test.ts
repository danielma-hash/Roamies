import {expect,it} from 'vitest';
import {PanelViewStateService} from '../panel-view-state.service.js';
const id='12345678-1234-4567-8901-123456789abc';
it('restores isolated drafts and does not reseed incompatible fields',()=>{
 let raw:string|null=null;const storage={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value;}};
 const first=new PanelViewStateService(storage);expect(first.save(id,'form','fields-v1',{name:'עברית'})).toBe(true);
 const restarted=new PanelViewStateService(storage);expect(restarted.read(id,'form','fields-v1')).toEqual({name:'עברית'});
 expect(restarted.read(id,'other','fields-v1')).toBeUndefined();expect(restarted.read(id,'form','fields-v2')).toBeUndefined();
 const copy=restarted.read(id,'form','fields-v1') as Record<string,string>;copy.name='mutated';expect(restarted.read(id,'form','fields-v1')?.name).toBe('עברית');
});
it('preserves malformed data without overwriting it and reports unavailable storage',()=>{
 let raw='broken';const broken=new PanelViewStateService({getItem:()=>raw,setItem:(_k,v)=>{raw=v;}});
 expect(broken.save(id,'form','v1',{name:'new'})).toBe(false);expect(raw).toBe('broken');expect(broken.error).toContain('לא אופס');
 const full=new PanelViewStateService({getItem:()=>null,setItem:()=>{throw new Error('quota');}});
 expect(full.save(id,'form','v1',{name:'new'})).toBe(false);expect(full.error).toContain('לא נשמרה');expect(full.read(id,'form','v1')).toBeUndefined();
});
it('bounds untrusted stored values before they can restore into controls',()=>{
 const service=new PanelViewStateService({getItem:()=>null,setItem:()=>{}});
 expect(service.save(id,'form','v1',{name:'x'.repeat(401)})).toBe(false);
 expect(service.save(id,'form','v1',Object.fromEntries(Array.from({length:13},(_,i)=>[`k${i}`,'v'])))).toBe(false);
});

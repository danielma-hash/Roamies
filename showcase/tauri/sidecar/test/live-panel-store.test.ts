import {mkdtemp,readFile,writeFile,stat,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {LivePanelStoreService} from '../live-panel-store.service.js';
import {LivePanelService} from '../live-panel.service.js';
const directories:string[]=[];
afterEach(async()=>{for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});
async function setup(){const dir=await mkdtemp(join(tmpdir(),'roamies-panels-'));directories.push(dir);const file=join(dir,'panels.json');const store=new LivePanelStoreService(file);return {dir,file,store,service:new LivePanelService(store)};}
const spec={title:'לוח בעברית',blocks:[{kind:'text' as const,id:'note',title:'כותרת',body:'Hello עברית'}]};
it('restores the selected panel and version history after a fresh service starts',async()=>{
 const {file,store,service}=await setup();const first=await service.show(spec);await service.show({...spec,title:'שני'});
 await service.update(first.id,1,{...spec,title:'מעודכן'});
 const recovered=new LivePanelService(store);await recovered.initialize();expect(recovered.snapshot()).toMatchObject({id:first.id,revision:2,spec:{title:'מעודכן'}});
 expect((await recovered.read(first.id,1)).spec.title).toBe('לוח בעברית');expect(recovered.list()).toHaveLength(2);
 expect((await stat(file)).mode&0o777).toBe(0o600);expect(await recovered.waitForRender('not-current')).toBe(false);
});
it('serializes concurrent writes and rejects stale revisions without overwriting progress',async()=>{
 const {service}=await setup();const panel=await service.show(spec);
 const results=await Promise.allSettled([service.update(panel.id,1,{...spec,title:'א'}),service.update(panel.id,1,{...spec,title:'ב'})]);
 expect(results.map(result=>result.status)).toEqual(['fulfilled','rejected']);expect(service.snapshot()?.spec.title).toBe('א');
 for(let version=2;version<8;version++)await service.update(panel.id,version,spec);
 expect(service.list()[0]?.revisions).toEqual([4,5,6,7,8]);await expect(service.read(panel.id,1)).rejects.toThrow('אינו שמור');
});
it('keeps damaged files unchanged and refuses writes after failed recovery',async()=>{
 const {file,store}=await setup();await writeFile(file,'broken');const service=new LivePanelService(store);
 await expect(service.initialize()).rejects.toThrow('ללא איפוס');await expect(service.show(spec)).rejects.toThrow('ללא איפוס');expect(await readFile(file,'utf8')).toBe('broken');
});
it('rejects symlink and duplicate/cross-panel revision histories',async()=>{
 const {dir,file,store}=await setup();await writeFile(join(dir,'target'),'{}');await symlink(join(dir,'target'),file);await expect(store.load()).rejects.toThrow('ללא איפוס');
 const panel={id:'12345678-1234-4567-8901-123456789abc',revision:1,createdAt:new Date().toISOString(),spec};
 await expect(store.save({version:1,panels:[[panel],[panel]]})).rejects.toThrow();
});
it('does not publish a panel when persistence fails and keeps an existing snapshot',async()=>{
 let failed=false;const store={load:async()=>({version:1 as const,panels:[]}),save:async()=>{if(failed)throw new Error('fixture disk full');}};
 const service=new LivePanelService(store);const panel=await service.show(spec);failed=true;
 await expect(service.update(panel.id,1,{...spec,title:'lost'})).rejects.toThrow('disk full');expect(service.snapshot()?.spec.title).toBe('לוח בעברית');
});
it('keeps existing panels at capacity and does not silently evict them',async()=>{
 const service=new LivePanelService();for(let i=0;i<20;i++)await service.show({...spec,title:`${i}`});
 await expect(service.show(spec)).rejects.toThrow('20');expect(service.list()).toHaveLength(20);expect(service.list()[0]?.title).toBe('0');
});

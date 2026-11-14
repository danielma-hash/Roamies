// @vitest-environment happy-dom
import {expect,it,vi} from 'vitest';
import {PanelLibraryView} from '../browser-panel-library.js';
it('lists saved panels as literal text and opens only the selected stored ID',async()=>{
 const root=document.createElement('div');const open=vi.fn(async()=>undefined);const view=new PanelLibraryView(root,open);
 const id='12345678-1234-4567-8901-123456789abc';view.receive({kind:'live_panel_library',selectedId:id,panels:[{id,title:'<img src=x>',revision:2,createdAt:'2026-11-14T08:00:00Z',revisions:[1,2]}]});
 expect(root.querySelector('img')).toBeNull();expect(root.textContent).toContain('<img src=x>');
 const select=root.querySelector('select')!;expect(select.value).toBe(id);select.dispatchEvent(new Event('change'));await Promise.resolve();expect(open).toHaveBeenCalledWith(id);
 view.receive({kind:'live_panel_library',panels:[{id:'bad'}]});expect(select.value).toBe(id);
});

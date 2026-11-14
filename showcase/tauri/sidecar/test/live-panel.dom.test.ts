// @vitest-environment happy-dom
import {afterEach,expect,it} from 'vitest';
import {LivePanelView} from '../browser-live-panel.js';
import type {LivePanelEnvelope} from '../live-panel.types.js';
afterEach(()=>document.body.replaceChildren());
function fixture(){const root=document.createElement('main');document.body.append(root);const view=new LivePanelView(root);return {root,view};}
const panel:LivePanelEnvelope={id:'12345678-1234-4567-8901-123456789abc',revision:1,createdAt:'2026-11-14T08:00:00Z',spec:{title:'מרכז בדיקה',sourceNote:'נתוני fixture',blocks:[
 {kind:'text',id:'note',title:'טקסט בטוח',body:'<img src=x onerror="globalThis.pwned=true">'},
 {kind:'table',id:'table',title:'השוואה',columns:['פרויקט','מצב'],rows:[['Roamies','בדיקה'],['PacoBot','פעיל']]},
 {kind:'bar',id:'chart',title:'התקדמות',unit:'%',points:[{label:'בדיקות',value:80},{label:'מימוש',value:60}]},
 {kind:'form',id:'form',title:'העדפות',fields:[{id:'name',label:'שם',kind:'text'},{id:'mode',label:'מצב',kind:'select',options:['קצר','מפורט'],value:'קצר'},{id:'on',label:'פעיל',kind:'toggle',value:'true'}]},
 {kind:'board',id:'board',title:'לוח',columns:[{title:'בתהליך',cards:[{title:'בדיקה',detail:'פרט בעברית'}]}]},
 {kind:'flow',id:'flow',title:'תהליך',nodes:[{id:'a',title:'בקשה'},{id:'b',title:'תוצאה'}],edges:[{from:'a',to:'b',label:'בדיקה'}]},
]}};
it('renders all catalog components with text-only data and no executable markup',()=>{
 const {root,view}=fixture();expect(view.receive(panel)).toBe(true);expect(root.querySelectorAll('.live-block')).toHaveLength(6);
 expect(root.querySelector('img,script,iframe')).toBeNull();expect(root.textContent).toContain('<img src=x onerror=');
 expect(root.querySelector('svg text')?.textContent).toBe('בקשה');expect(root.querySelectorAll('progress')).toHaveLength(2);
 expect(root.querySelector('th')?.getAttribute('scope')).toBe('col');expect(root.querySelector('input[type=search]')?.getAttribute('aria-label')).toContain('השוואה');
});
it('filters locally and preserves form drafts when the same revision is received again',()=>{
 const {root,view}=fixture();view.receive(panel);const search=root.querySelector<HTMLInputElement>('input[type=search]')!;search.value='Roamies';search.dispatchEvent(new Event('input'));
 expect(root.querySelectorAll('tbody tr')).toHaveLength(1);expect(root.querySelector('tbody')?.textContent).not.toContain('PacoBot');
 const input=root.querySelector<HTMLInputElement>('input[name=name]')!;input.value='דניאל';
 expect(view.receive(structuredClone(panel))).toBe(false);expect(root.querySelector<HTMLInputElement>('input[name=name]')?.value).toBe('דניאל');
 const event=new Event('submit',{cancelable:true});root.querySelector('form')!.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);
 expect(root.querySelector('.live-form-preview')?.textContent).toContain('שם: דניאל');
});
it('refuses invalid replacement data without destroying the current valid panel',()=>{
 const {root,view}=fixture();view.receive(panel);expect(view.receive({...panel,revision:2,spec:{...panel.spec,script:'bad'}})).toBe(false);expect(root.querySelector('h1')?.textContent).toBe('מרכז בדיקה');
});

it('restores filters and form fields after remount without submitting actions',async()=>{
 const {PanelViewStateService}=await import('../panel-view-state.service.js');let raw:string|null=null;
 const storage={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value;}};
 const root=document.createElement('main');document.body.append(root);new LivePanelView(root,new PanelViewStateService(storage)).receive(panel);
 const search=root.querySelector<HTMLInputElement>('input[type=search]')!;search.value='Roamies';search.dispatchEvent(new Event('input',{bubbles:true}));
 const input=root.querySelector<HTMLInputElement>('input[name=name]')!;input.value='טיוטה בעברית';input.dispatchEvent(new Event('input',{bubbles:true}));
 const selected=root.querySelector<HTMLSelectElement>('select')!;selected.value='מפורט';selected.dispatchEvent(new Event('change',{bubbles:true}));
 const toggle=root.querySelector<HTMLInputElement>('input[type=checkbox]')!;toggle.checked=false;toggle.dispatchEvent(new Event('change',{bubbles:true}));
 root.replaceChildren();const view=new LivePanelView(root,new PanelViewStateService(storage));view.receive({...panel,revision:2});
 expect(root.querySelectorAll('tbody tr')).toHaveLength(1);expect(root.querySelector<HTMLInputElement>('input[name=name]')?.value).toBe('טיוטה בעברית');expect(root.querySelector('select')?.value).toBe('מפורט');expect(root.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(false);expect(root.querySelector('.live-form-preview')?.textContent).toBe('');
 const changed=structuredClone(panel);changed.revision=3;const form=changed.spec.blocks.find(block=>block.kind==='form')!;form.fields[0]!.label='משמעות חדשה';view.receive(changed);
 expect(root.querySelector<HTMLInputElement>('input[name=name]')?.value).toBe('');
});

it('updates live rows without remounting the filter, and ignores an obsolete panel revision',()=>{
 const {root,view}=fixture();view.receive({...panel,spec:{title:'חי',blocks:[{kind:'query',id:'q',title:'סשנים',source:'sessions'}]}});
 const message={kind:'live_query',panelId:panel.id,revision:1,blockId:'q',status:'ready',table:{columns:['שם'],rows:[['Alpha'],['Beta']],rowIds:['a','b'],observedAt:Date.now(),source:'fixture'}};
 expect(view.receiveQuery(message)).toBe(true);const filter=root.querySelector<HTMLInputElement>('input[type=search]')!;filter.value='Alpha';filter.dispatchEvent(new Event('input',{bubbles:true}));
 view.receiveQuery({...message,table:{...message.table,rows:[['Alpha updated'],['Beta']],observedAt:Date.now()}});
 expect(root.querySelector('input[type=search]')).toBe(filter);expect(root.querySelectorAll('tbody tr')).toHaveLength(1);expect(root.querySelector('tbody')?.textContent).toBe('Alpha updated');
 expect(view.receiveQuery({...message,revision:2})).toBe(false);view.receiveQuery({...message,status:'paused',table:undefined});expect(root.querySelector('table')).toBeNull();expect(root.textContent).toContain('מושהה');
});

import {afterEach,it,expect,vi} from 'vitest';
import {Window} from 'happy-dom';
import {TaskHistoryView} from '../browser-task-history.js';
const id='12345678-1234-4567-8901-123456789abc';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
function fixture(){const window=new Window();vi.stubGlobal('document',window.document);const root=window.document.createElement('div');window.document.body.append(root);const send=vi.fn(async(_message:unknown)=>{});const view=new TaskHistoryView(root as unknown as HTMLElement,send);return {window,root,send,view};}
const snapshot={actions:true,archived:false,query:'',page:1,total:1,observedAt:100,rows:[{id,request:'<img src=x onerror=alert(1)> משימה',status:'interrupted',updatedAt:123,archived:false,uncertain:1,tools:1}]};
it('ignores unsolicited replies without an active request',()=>{
 const f=fixture();f.view.receive({requestId:undefined,snapshot});expect(f.root.textContent).not.toContain(snapshot.rows[0]!.request);
});
it('binds archive to exact ID/version, renders text safely and does not send twice',()=>{
 const f=fixture();f.view.refresh();const first=f.send.mock.calls[0]![0] as {requestId:string};
 f.view.receive({requestId:first.requestId,snapshot});expect(f.root.querySelector('img')).toBeNull();expect(f.root.textContent).toContain(snapshot.rows[0]!.request);
 const button=[...f.root.querySelectorAll('button')].find(button=>button.textContent==='העברה לארכיון')!;button.click();button.click();expect(f.send).toHaveBeenCalledTimes(2);
 const next=f.send.mock.calls[1]![0] as {requestId:string;input:unknown};expect(next.input).toEqual({id,expectedUpdatedAt:123,archived:true});
 f.view.receive({requestId:first.requestId,snapshot:{...snapshot,total:0,rows:[]}});expect(button.disabled).toBe(true);
 f.view.receive({requestId:next.requestId,snapshot:{...snapshot,total:0,rows:[]}});expect(f.root.textContent).toContain('אין משימות');
});
it('disables active actions, exposes restore for archive and reports timeout without replay',()=>{
 vi.useFakeTimers();const f=fixture();f.view.refresh();const first=f.send.mock.calls[0]![0] as {requestId:string};
 f.view.receive({requestId:first.requestId,snapshot:{...snapshot,rows:[{...snapshot.rows[0],status:'running'}]}});expect([...f.root.querySelectorAll('button')].find(b=>b.textContent==='העברה לארכיון')?.disabled).toBe(true);
 [...f.root.querySelectorAll('button')].find(b=>b.textContent==='ארכיון')!.click();const second=f.send.mock.calls[1]![0] as {requestId:string};
 f.view.receive({requestId:second.requestId,snapshot:{...snapshot,archived:true,rows:[{...snapshot.rows[0],archived:true}]}});
 [...f.root.querySelectorAll('button')].find(b=>b.textContent==='החזרה לרשימה')!.click();vi.advanceTimersByTime(15_001);expect(f.send).toHaveBeenCalledTimes(3);expect(f.root.textContent).toContain('הפעולה לא נשלחה שוב');
});

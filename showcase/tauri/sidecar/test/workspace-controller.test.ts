import { expect,it,vi } from 'vitest';
import { WorkspaceController } from '../workspace-controller.js';
import { ClaudeSessionsService } from '../claude-sessions.service.js';
it('lists real adapter data and does not fork an undiscovered target',async()=>{const fork=vi.fn();const sessions=new ClaudeSessionsService({sdk:{listSessions:async()=>[],forkSession:fork}});const changed=vi.fn();const workspace=new WorkspaceController(sessions,changed);await workspace.handle({action:'sessions.list'});expect(workspace.snapshot()).toMatchObject({available:true,sessions:[],busy:false});await workspace.handle({action:'sessions.fork',id:'invented'});expect(fork).not.toHaveBeenCalled();expect(workspace.snapshot().error).toContain('לא נמצאה');expect(changed).toHaveBeenCalled();});

it('clears old memory results and exposes a refresh failure', async () => {
  const { AsmMemoryService } = await import('../asm-memory.service.js');
  const memory = new AsmMemoryService();
  vi.spyOn(memory, 'search').mockResolvedValueOnce([{source:'memory',id:'memory:test',title:'test',excerpt:'old',path:'test',status:'active'}]).mockRejectedValueOnce(new Error('לא ניתן לרענן את הזיכרון'));
  const workspace = new WorkspaceController(new ClaudeSessionsService({sdk:{listSessions:async()=>[]}}),vi.fn(),undefined,memory);
  await workspace.handle({action:'memory.search',query:'test',scope:'company'});
  expect(workspace.snapshot().citations).toHaveLength(1);
  await workspace.handle({action:'memory.search',query:'test',scope:'company'});
  expect(workspace.snapshot()).toMatchObject({citations:[],error:'לא ניתן לרענן את הזיכרון',busy:false});
});

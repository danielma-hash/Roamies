import { expect,it,vi } from 'vitest';
import { ClaudeSessionsService } from '../claude-sessions.service.js';
import { createWorkspaceTools } from '../workspace-tools.js';
it('never forks without actions enabled and explicit confirmation',async()=>{const fork=vi.fn();const service=new ClaudeSessionsService({sdk:{forkSession:fork}});const confirm=vi.fn(async()=>true);const tool=createWorkspaceTools({sessions:service,allowActions:()=>false,confirm}).find(t=>t.name==='claude_session_fork')!;expect(JSON.parse(await tool.execute({id:'selected'}))).toEqual({error:'יצירת עותק דורשת הפעלת פעולות בהגדרות.'});expect(confirm).not.toHaveBeenCalled();expect(fork).not.toHaveBeenCalled();});

it('cancels pending approval and never forks after Stop or disabling actions', async () => {
  const id = '12345678-1234-4567-8901-123456789abc';
  const fork = vi.fn(async () => ({ sessionId: '12345678-1234-4567-8901-123456789abd' }));
  const service = new ClaudeSessionsService({ sdk: { listSessions: async () => [{ sessionId: id, summary: 'test', cwd: '/project', lastModified: 1 }], getSessionMessages: async () => [], forkSession: fork } });
  await service.list();
  let approve: ((approved: boolean) => void) | undefined;
  const confirm = vi.fn(() => new Promise<boolean>((resolve) => { approve = resolve; }));
  const tool = createWorkspaceTools({ sessions: service, allowActions: () => true, confirm }).find((item) => item.name === 'claude_session_fork')!;
  const controller = new AbortController();
  const pending = tool.execute({ id }, { signal: controller.signal, toolCallId: 'fork' });
  await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
  controller.abort(new Error('stopped'));
  await expect(pending).rejects.toThrow('stopped');
  approve?.(true); await Promise.resolve(); expect(fork).not.toHaveBeenCalled();
  let allowed = true;
  const disabled = createWorkspaceTools({ sessions: service, allowActions: () => allowed, confirm: async () => { allowed = false; return true; } }).find((item) => item.name === 'claude_session_fork')!;
  expect(JSON.parse(await disabled.execute({ id }))).toHaveProperty('error'); expect(fork).not.toHaveBeenCalled();
});

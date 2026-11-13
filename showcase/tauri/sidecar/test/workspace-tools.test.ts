import { expect,it,vi } from 'vitest';
import { ClaudeSessionsService } from '../claude-sessions.service.js';
import { createWorkspaceTools } from '../workspace-tools.js';
it('never forks without actions enabled and explicit confirmation',async()=>{const fork=vi.fn();const service=new ClaudeSessionsService({sdk:{forkSession:fork}});const confirm=vi.fn(async()=>true);const tool=createWorkspaceTools({sessions:service,allowActions:()=>false,confirm}).find(t=>t.name==='claude_session_fork')!;expect(await tool.execute({id:'selected'})).toEqual({error:'יצירת עותק דורשת הפעלת פעולות בהגדרות.'});expect(confirm).not.toHaveBeenCalled();expect(fork).not.toHaveBeenCalled();});

import { expect,it,vi } from 'vitest';
import { WorkspaceController } from '../workspace-controller.js';
import { ClaudeSessionsService } from '../claude-sessions.service.js';
it('lists real adapter data and does not fork an undiscovered target',async()=>{const fork=vi.fn();const sessions=new ClaudeSessionsService({sdk:{listSessions:async()=>[],forkSession:fork}});const changed=vi.fn();const workspace=new WorkspaceController(sessions,changed);await workspace.handle({action:'sessions.list'});expect(workspace.snapshot()).toMatchObject({available:true,sessions:[],busy:false});await workspace.handle({action:'sessions.fork',id:'invented'});expect(fork).not.toHaveBeenCalled();expect(workspace.snapshot().error).toContain('לא נמצאה');expect(changed).toHaveBeenCalled();});

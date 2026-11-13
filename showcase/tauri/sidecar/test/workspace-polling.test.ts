import { expect, it, vi } from 'vitest';
import { WorkspaceController } from '../workspace-controller.js';
import { ClaudeSessionsService } from '../claude-sessions.service.js';
import { TaskCardsService } from '../task-cards.service.js';
import { AttentionService } from '../attention.service.js';

it('continues refreshing sessions and attention after a GitHub failure and shows the error', async () => {
  let now = 1000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    const list = vi.fn(async () => []);
    const sessions = new ClaudeSessionsService({ sdk: { listSessions:list } });
    const read = vi.fn(async () => JSON.stringify({ title:'PR',url:'https://github.com/team/project/pull/1',state:'OPEN',headRefName:'fix',headRefOid:'abc',statusCheckRollup:[] }));
    const tasks = new TaskCardsService(read);
    await tasks.track('https://github.com/team/project/pull/1');
    read.mockRejectedValue(new Error('fixture GitHub failure'));
    const attention = new AttentionService({ filePath:'/unused-fixture-attention.json' });
    const update = vi.spyOn(attention, 'update').mockResolvedValue([]);
    vi.spyOn(attention, 'snapshot').mockResolvedValue({preferences:{quiet:false,focus:false},events:[],unread:0});
    const changed = vi.fn();
    const controller = new WorkspaceController(sessions, changed, undefined, undefined, tasks, attention);
    now += 300001;
    await controller.poll();
    expect(list).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(controller.snapshot().error).toContain('GitHub');
    expect(controller.snapshot().cards).toHaveLength(1);
    expect(changed).toHaveBeenCalled();
    await controller.poll();
    expect(list).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledTimes(2); // Initial card and the failed refresh only.
  } finally { clock.mockRestore(); }
});

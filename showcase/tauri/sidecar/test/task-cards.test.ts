import { expect, it, vi } from 'vitest';
import { TaskCardsService } from '../task-cards.service.js';
it('validates targets before invoking gh and never equates merge or checks with deployment', async () => {
  const read = vi.fn(async () => JSON.stringify({ title:'תיקון',url:'https://github.com/team/project/pull/1',state:'MERGED',headRefName:'fix',headRefOid:'abc',statusCheckRollup:[{conclusion:'SUCCESS'}] }));
  const service = new TaskCardsService(read);
  await expect(service.read('https://evil.invalid/a')).rejects.toThrow(); expect(read).not.toHaveBeenCalled();
  const card = await service.read('https://github.com/team/project/pull/1'); expect(card.deployment).toBe('unknown'); expect(card.state).toBe('MERGED'); expect(read).toHaveBeenCalledWith('team/project','1');
});

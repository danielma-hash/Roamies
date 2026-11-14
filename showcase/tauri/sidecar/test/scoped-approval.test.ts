import { afterEach, expect, it, vi } from 'vitest';
import { ScopedApprovalService } from '../scoped-approval.service.js';
afterEach(() => vi.useRealTimers());
it('accepts one exact request once, never an unrelated or replayed response', async () => {
  const changed = vi.fn(); const service = new ScopedApprovalService(changed);
  const result = service.request('המשך את סשן הבדיקה'); const id = service.current()!.id;
  expect(service.answer('another', true)).toBe(false); expect(service.current()?.id).toBe(id);
  expect(service.answer(id, true)).toBe(true); expect(await result).toBe(true);
  expect(service.answer(id, true)).toBe(false); expect(changed).toHaveBeenCalledTimes(2);
});
it('cancels on close, expiry and abort without remembering grants', async () => {
  vi.useFakeTimers(); const service = new ScopedApprovalService(() => {}, 1000);
  const closed = service.request('one'); service.cancel(); expect(await closed).toBe(false);
  const expired = service.request('two'); vi.advanceTimersByTime(1001); expect(await expired).toBe(false);
  const signal = new AbortController(); const aborted = service.request('three', signal.signal); signal.abort(); expect(await aborted).toBe(false);
  expect(service.current()).toBeUndefined(); expect(await service.request('four', signal.signal)).toBe(false);
});
it('never silently replaces a visible request', async () => {
  const service = new ScopedApprovalService(() => {}); const first = service.request('one');
  expect(await service.request('two')).toBe(false); expect(service.current()?.question).toBe('one');
  service.cancel(); expect(await first).toBe(false);
});

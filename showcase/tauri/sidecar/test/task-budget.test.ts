import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { TaskBudgetService, DEFAULT_TASK_BUDGET, withTaskBudget } from '../task-budget.service.js';
import type { AgentTool } from '@kenkaiiii/gg-agent';
const context = () => ({ signal: new AbortController().signal, toolCallId: 'test' });
const fixture = (name: string, execute = vi.fn(async () => 'same')): AgentTool => ({ name, description: 'fixture', parameters: z.object({}), execute });
afterEach(() => vi.useRealTimers());
it('reserves tool and screenshot budgets before executing, including concurrent calls', async () => {
  const stop = vi.fn(); const budget = new TaskBudgetService(stop, { ...DEFAULT_TASK_BUDGET, tools: 1 }); const perform = vi.fn(async () => 'ok');
  try {
    const first = budget.execute(fixture('fixture', perform), {}, context());
    await expect(budget.execute(fixture('fixture', perform), {}, context())).rejects.toMatchObject({ reason: 'tools' }); await first;
    expect(perform).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce(); expect(budget.snapshot().tools).toBe(1);
  } finally { budget.close(); }
  const screenshot = new TaskBudgetService(vi.fn(), { ...DEFAULT_TASK_BUDGET, screenshots: 0 });
  try { await expect(screenshot.execute(fixture('take_screenshot', perform), {}, context())).rejects.toMatchObject({ reason: 'screenshots' }); expect(perform).toHaveBeenCalledOnce(); }
  finally { screenshot.close(); }
});
it('stops a fourth identical read even if argument key order or plan-step calls change', async () => {
  const budget = new TaskBudgetService(vi.fn()); const read = fixture('read_file');
  try {
    for (let i = 0; i < 3; i++) { await budget.execute(read, { path: 'x', offset: 0 }, context()); await budget.execute(fixture('plan_steps'), {}, context()); }
    await expect(budget.execute(read, { offset: 0, path: 'x' }, context())).rejects.toMatchObject({ reason: 'no_progress' });
  } finally { budget.close(); }
});
it('resets repetition when data changes or an action may have changed the target', async () => {
  const budget = new TaskBudgetService(vi.fn()); let version = 'first'; const read = fixture('read_file', vi.fn(async () => version));
  try {
    await budget.execute(read, {}, context()); await budget.execute(read, {}, context()); version = 'second';
    await budget.execute(read, {}, context()); await budget.execute(read, {}, context()); await budget.execute(read, {}, context());
    await budget.execute(fixture('write_file'), {}, context()); await expect(budget.execute(read, {}, context())).resolves.toBe('second');
  } finally { budget.close(); }
});
it('retains unknown usage instead of calling absent reporting zero cost, and stops after reported limits', () => {
  const budget = new TaskBudgetService(vi.fn(), { ...DEFAULT_TASK_BUDGET, tokens: 100 });
  try {
    budget.observeUsage(); expect(budget.snapshot()).toMatchObject({ usageReported: false, usageIncomplete: true });
    budget.observeUsage({ inputTokens: 20, outputTokens: 10, cacheRead: 30 });
    expect(() => budget.observeUsage({ inputTokens: 30, outputTokens: 10 })).toThrow('טוקנים');
    expect(budget.snapshot()).toMatchObject({ inputTokens: 50, outputTokens: 20, cacheRead: 30, stoppedReason: 'tokens' });
  } finally { budget.close(); }
});
it('cancels on elapsed time without waiting for another model event, and close removes the timer', async () => {
  vi.useFakeTimers(); const stop = vi.fn(); const budget = new TaskBudgetService(stop, { ...DEFAULT_TASK_BUDGET, durationMs: 100 }, () => Date.now());
  await vi.advanceTimersByTimeAsync(100); expect(stop).toHaveBeenCalledOnce(); expect(() => budget.check()).toThrow('הזמן'); budget.close();
  const closed = new TaskBudgetService(stop, { ...DEFAULT_TASK_BUDGET, durationMs: 100 }); closed.close();
  await vi.advanceTimersByTimeAsync(1000); expect(stop).toHaveBeenCalledOnce();
});
it('preserves tool metadata through the guard and denies calls outside an active request', async () => {
  const tool = { ...fixture('fixture'), executionMode: 'sequential' as const, timeoutMs: 9000 };
  const wrapped = withTaskBudget([tool], () => undefined)[0]!;
  expect(wrapped).toMatchObject({ executionMode: 'sequential', timeoutMs: 9000 });
  expect(() => wrapped.execute({}, context())).toThrow();
});

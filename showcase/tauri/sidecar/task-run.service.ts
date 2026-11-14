import { createHash, randomUUID } from 'node:crypto';
import type { AgentTool } from '@kenkaiiii/gg-agent';
import { redactClaudeText } from './claude-sessions.service.js';
import { TaskRunStoreService } from './task-run-store.service.js';
import { TaskRunError } from './task-run-error.js';
import type { TaskRun, TaskRunArchive } from './task-run.types.js';
import type { TaskBudgetSnapshot } from './task-budget.types.js';

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
const unfinished = (run: TaskRun): boolean => run.status === 'queued' || run.status === 'running';

export class TaskRunService {
  private archive: TaskRunArchive = { version: 1, runs: [] };
  private loading?: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  private failure?: TaskRunError;
  constructor(private readonly store: TaskRunStoreService) {}
  initialize(): Promise<void> {
    return this.loading ??= (async () => {
      try {
        const archive = await this.store.load();
        let changed = false;
        for (const run of archive.runs) if (unfinished(run)) { this.interrupt(run); changed = true; }
        if (changed) await this.store.save(archive);
        this.archive = archive;
      } catch { this.failure = new TaskRunError(); throw this.failure; }
    })();
  }
  list(): readonly TaskRun[] { return structuredClone(this.archive.runs); }
  get(id: string): TaskRun {
    const found = this.archive.runs.find((run) => run.id === id);
    if (!found) throw new TaskRunError('המשימה אינה קיימת ביומן המקומי.');
    return structuredClone(found);
  }
  async flush(): Promise<void> { await this.tail; if (this.failure) throw this.failure; }
  private change<T>(update: (runs: TaskRun[]) => T): Promise<T> {
    const promise = this.tail.then(async () => {
      await this.initialize(); if (this.failure) throw this.failure;
      const next = structuredClone(this.archive); const value = update(next.runs);
      try { await this.store.save(next); }
      catch { this.failure = new TaskRunError(); throw this.failure; }
      this.archive = next; return structuredClone(value);
    });
    this.tail = promise.then(() => undefined, () => undefined);
    return promise;
  }
  create(request: string, hasImage = false): Promise<TaskRun> {
    return this.change((runs) => {
      if (runs.length >= 100) {
        const oldest = runs.findIndex((run) => (run.status === 'returned' || run.status === 'failed') && run.tools.every((tool) => tool.status === 'returned'));
        if (oldest < 0) throw new TaskRunError('יומן המשימות מלא במשימות שדורשות בדיקה. לא נמחקה התקדמות.');
        runs.splice(oldest, 1);
      }
      const run: TaskRun = { id: randomUUID(), request: redactClaudeText(request).slice(0, 12_000), hasImage, verified: false,
        status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), tools: [] };
      runs.push(run); return run;
    });
  }
  start(id: string, conversationId?: string): Promise<void> {
    return this.change((runs) => {
      const run = this.find(runs, id);
      if (run.status !== 'queued') throw new TaskRunError('משימה שנקטעה אינה מופעלת מחדש אוטומטית.');
      run.status = 'running'; run.conversationId = conversationId; run.updatedAt = Date.now();
    });
  }
  beginTool(id: string, callId: string, name: string, args: unknown, budget?: TaskBudgetSnapshot): Promise<void> {
    return this.change((runs) => {
      const run = this.find(runs, id);
      if (run.status !== 'running') throw new TaskRunError('המשימה כבר אינה פעילה.');
      if (run.tools.some((tool) => tool.id === callId)) throw new TaskRunError('קריאה זו כבר נרשמה. יש לבדוק את היעד לפני ניסיון חוזר.');
      if (run.tools.length >= 200) throw new TaskRunError('המשימה הגיעה למגבלת 200 קריאות כלים.');
      run.tools.push({ id: callId, name, argsDigest: digest(args), status: 'pending' }); run.updatedAt = Date.now();
      if (budget) run.budget = budget;
    });
  }
  endTool(id: string, callId: string, result: unknown, error = false, budget?: TaskBudgetSnapshot): Promise<void> {
    return this.change((runs) => {
      const run = this.find(runs, id); const tool = run.tools.find((item) => item.id === callId);
      if (!tool) throw new TaskRunError('אין checkpoint לקריאת הכלי.');
      // Late results after interruption do not turn an uncertain outcome into verified success.
      if (run.status !== 'running' || tool.status !== 'pending') return;
      tool.status = error ? 'error' : 'returned'; tool.resultDigest = digest(result); run.updatedAt = Date.now();
      if (budget) run.budget = budget;
    });
  }
  finish(id: string, status: 'returned' | 'failed' | 'interrupted', budget?: TaskBudgetSnapshot): Promise<void> {
    return this.change((runs) => {
      const run = this.find(runs, id);
      if (!unfinished(run)) return;
      run.status = status; run.updatedAt = Date.now();
      if (budget) run.budget = budget;
      for (const tool of run.tools) if (tool.status === 'pending') tool.status = 'unknown';
    });
  }
  interruptAll(): Promise<void> {
    return this.change((runs) => { for (const run of runs) if (unfinished(run)) this.interrupt(run); });
  }
  updateBudget(id: string, budget: TaskBudgetSnapshot): Promise<void> {
    return this.change((runs) => { const run = this.find(runs, id); if (run.status === 'running') run.budget = budget; });
  }
  wrap(tools: readonly AgentTool[], current: () => string | undefined, onStorageFailure: () => void, budget?: () => TaskBudgetSnapshot | undefined): AgentTool[] {
    return tools.map((tool) => ({ ...tool, execute: async (args: unknown, context) => {
      context.signal.throwIfAborted();
      const id = current(); if (!id) throw new TaskRunError('אין משימה פעילה לביצוע הכלי.');
      try {
        await this.beginTool(id, context.toolCallId, tool.name, args, budget?.());
        context.signal.throwIfAborted();
        let result;
        try { result = await tool.execute(args, context); }
        catch (error: unknown) { await this.endTool(id, context.toolCallId, 'tool threw; effects may already have occurred', true, budget?.()); throw error; }
        await this.endTool(id, context.toolCallId, result, false, budget?.());
        return result;
      } catch (error: unknown) { if (this.failure) onStorageFailure(); throw error; }
    } }));
  }
  private find(runs: TaskRun[], id: string): TaskRun {
    const run = runs.find((item) => item.id === id); if (!run) throw new TaskRunError('המשימה אינה קיימת.'); return run;
  }
  private interrupt(run: TaskRun): void {
    run.status = 'interrupted'; run.updatedAt = Date.now();
    for (const tool of run.tools) if (tool.status === 'pending') tool.status = 'unknown';
  }
}

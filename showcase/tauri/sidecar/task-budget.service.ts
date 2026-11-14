import { createHash } from 'node:crypto';
import type { AgentTool, ToolContext, ToolExecuteResult } from '@kenkaiiii/gg-agent';
import { TaskBudgetError } from './task-budget-error.js';
import { taskBudgetSnapshotSchema } from './task-budget.schema.js';
import type { TaskBudgetLimits, TaskBudgetReason, TaskBudgetSnapshot, TaskReportedUsage } from './task-budget.types.js';

export const DEFAULT_TASK_BUDGET: TaskBudgetLimits = Object.freeze({ tools: 64, screenshots: 6, tokens: 250_000, durationMs: 300_000, repeatedReads: 3 });
const READS = new Set(['read_file', 'list_files', 'search_files', 'fetch_url', 'list_windows', 'read_window', 'desktop_read', 'browser_read', 'browser_controls']);
const NO_EFFECT = new Set(['plan_steps', 'task_run_list', 'task_run_read']);
const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered) : value !== null && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)])) : value;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(ordered(value)) ?? 'undefined').digest('hex');
const valid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Bounds one foreground Jarvis request; provider usage is observed after a response, not a billing guarantee. */
export class TaskBudgetService {
  private readonly startedAt: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly state: TaskBudgetSnapshot;
  private readonly reads = new Map<string, { readonly digest: string; readonly count: number }>();
  constructor(private readonly onStop: () => void, limits: TaskBudgetLimits = DEFAULT_TASK_BUDGET, private readonly now: () => number = () => performance.now()) {
    this.startedAt = now();
    this.state = taskBudgetSnapshotSchema.parse({ limits, tools: 0, screenshots: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, usageReported: false, usageIncomplete: false, elapsedMs: 0 });
    this.timer = setTimeout(() => this.stop('time'), limits.durationMs); this.timer.unref();
  }
  snapshot(): TaskBudgetSnapshot { return { ...this.state, limits: { ...this.state.limits }, elapsedMs: Math.max(0, this.now() - this.startedAt) }; }
  close(): void { clearTimeout(this.timer); }
  check(): void {
    if (!this.state.stoppedReason && this.now() - this.startedAt >= this.state.limits.durationMs) this.stop('time');
    if (this.state.stoppedReason) throw new TaskBudgetError(this.state.stoppedReason);
  }
  observeUsage(usage?: TaskReportedUsage): void {
    if (!valid(usage?.inputTokens) || !valid(usage?.outputTokens)) this.state.usageIncomplete = true;
    for (const field of ['inputTokens', 'outputTokens', 'cacheRead', 'cacheWrite'] as const) {
      const value = usage?.[field]; if (!valid(value)) continue;
      this.state.usageReported = true; this.state[field] = Math.min(Number.MAX_SAFE_INTEGER, this.state[field] + value);
    }
    if (this.state.inputTokens + this.state.outputTokens + this.state.cacheRead + this.state.cacheWrite >= this.state.limits.tokens) this.stop('tokens');
    this.check();
  }
  async execute(tool: AgentTool, args: unknown, context: ToolContext): Promise<ToolExecuteResult> {
    this.check(); context.signal.throwIfAborted();
    if (this.state.tools >= this.state.limits.tools) this.stop('tools');
    if (tool.name === 'take_screenshot' && this.state.screenshots >= this.state.limits.screenshots) this.stop('screenshots');
    const key = READS.has(tool.name) ? `${tool.name}:${hash(args)}` : undefined;
    if (key && (this.reads.get(key)?.count ?? 0) >= this.state.limits.repeatedReads) this.stop('no_progress');
    this.check(); this.state.tools++;
    if (tool.name === 'take_screenshot') this.state.screenshots++;
    // A mutating/unknown operation may change what a later read should see.
    if (!key && !NO_EFFECT.has(tool.name)) this.reads.clear();
    try {
      const result = await tool.execute(args, context);
      if (key) this.observeRead(key, result);
      return result;
    } catch (error: unknown) {
      if (key) this.observeRead(key, error instanceof Error ? { error: error.name, message: error.message } : 'tool error');
      throw error;
    }
  }
  private observeRead(key: string, value: unknown): void {
    const digest = hash(value); const previous = this.reads.get(key);
    this.reads.set(key, { digest, count: previous?.digest === digest ? previous.count + 1 : 1 });
    if (this.reads.size > 64) this.reads.delete(this.reads.keys().next().value!);
  }
  private stop(reason: TaskBudgetReason): void {
    if (this.state.stoppedReason) return;
    this.state.stoppedReason = reason; clearTimeout(this.timer); this.onStop();
  }
}

export function withTaskBudget(tools: readonly AgentTool[], current: () => TaskBudgetService | undefined): AgentTool[] {
  return tools.map((tool) => ({ ...tool, execute: (args: unknown, context: ToolContext) => {
    const budget = current(); if (!budget) throw new TaskBudgetError('time');
    return budget.execute(tool, args, context);
  } }));
}

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
// @ts-expect-error Existing app safety module is JavaScript.
import { checkRead, checkWrite, classifyCommand, SAFE, BLOCK } from './safety.mjs';
import { CLAUDE_SESSION_ID, redactClaudeText } from './claude-sessions.service.js';
import { ClaudeInputQueue } from './claude-input-queue.js';
import type { ClaudeRunOptions, ClaudeRunSnapshot, ClaudeRunState } from './claude-run.types.js';

export class ClaudeRunError extends Error {
  constructor(message: string) { super(message); this.name = 'ClaudeRunError'; }
}
interface Run {
  readonly id: string; readonly title: string; readonly cwd: string;
  readonly input: ClaudeInputQueue; readonly query: Query; readonly abort: AbortController;
  readonly pending: string[];
  state: ClaudeRunState; lastReply: string; error?: string; done?: Promise<void>;
}
const TOOLS = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'];

/** Owns each live SDK process. Never signals an unrelated PID or resumes a live external writer. */
export class ClaudeRunService {
  private readonly runs = new Map<string, Run>();
  private readonly launching = new Set<string>();
  constructor(private readonly options: ClaudeRunOptions) {}

  list(): readonly ClaudeRunSnapshot[] { return [...this.runs.values()].map((run) => this.snapshot(run)); }
  get(id: string): ClaudeRunSnapshot { return this.snapshot(this.owned(id)); }
  private owned(id: string): Run {
    const run = this.runs.get(id);
    if (!run) throw new ClaudeRunError('הסשן אינו מנוהל בידי ג׳ארוויס. יש לסגור אותו ב-Claude ואז לבקש להמשיך אותו כאן.');
    return run;
  }
  private snapshot(run: Run): ClaudeRunSnapshot {
    return { id: run.id, title: run.title, cwd: run.cwd, state: run.state, queued: run.pending.length,
      lastReply: run.lastReply, ...(run.error ? { error: run.error } : {}) };
  }
  private enabled(signal?: AbortSignal): void {
    signal?.throwIfAborted();
    if (!this.options.allowActions()) throw new ClaudeRunError('יש להפעיל פעולות בהגדרות כדי לנהל סשני Claude.');
  }
  private prompt(text: string): string {
    if (!text.trim() || text.length > 12_000 || text.includes('\0')) throw new ClaudeRunError('ההוראה ריקה או ארוכה מדי.');
    return text.trim();
  }
  async start(cwd: string, title: string, text: string, resume?: string, signal?: AbortSignal): Promise<ClaudeRunSnapshot> {
    this.enabled(signal); text = this.prompt(text);
    if (!isAbsolute(cwd) || /[\x00-\x1f]/.test(cwd)) throw new ClaudeRunError('יש לבחור תיקיית פרויקט מלאה.');
    cwd = await realpath(cwd);
    if (!(await stat(cwd)).isDirectory() || checkRead(cwd, homedir(), { recursive: true }).level !== SAFE
      || checkWrite(cwd, homedir()).level === BLOCK) throw new ClaudeRunError('תיקיית הפרויקט אינה מותרת.');
    const id = resume ?? randomUUID();
    if (!CLAUDE_SESSION_ID.test(id)) throw new ClaudeRunError('מזהה סשן לא תקין.');
    if (this.launching.has(id) || this.runs.has(id) && !['stopped', 'failed'].includes(this.runs.get(id)!.state)) {
      throw new ClaudeRunError('הסשן כבר מנוהל כאן. יש לשלוח לו הוראה במקום להפעיל עותק נוסף.');
    }
    if ([...this.runs.values()].filter((run) => !['stopped', 'failed'].includes(run.state)).length + this.launching.size >= 4) {
      throw new ClaudeRunError('כבר מנוהלים ארבעה סשנים. יש לעצור אחד לפני פתיחת נוסף.');
    }
    this.launching.add(id);
    try {
      const previous = this.runs.get(id);
      if (previous?.done) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([previous.done, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new ClaudeRunError('התהליך הקודם עדיין נסגר. נסה שוב בעוד רגע.')), 5000);
          })]);
        } finally { if (timer) clearTimeout(timer); }
      }
      // Fail closed if the native CLI cannot enumerate live interactive/background sessions.
      if (resume && (await this.options.activeSessionIds()).includes(id)) throw new ClaudeRunError('הסשן עדיין פתוח ב-Claude. סגור אותו שם לפני העברה לג׳ארוויס; ההיסטוריה תישמר.');
      this.enabled(signal);
      const input = new ClaudeInputQueue();
      const abort = new AbortController();
      let run: Run | undefined;
      const query = this.options.query({ prompt: input, options: {
        cwd, ...(resume ? { resume } : { sessionId: id, title: redactClaudeText(title).slice(0, 160) }), pathToClaudeCodeExecutable: this.options.executable(),
        env: this.options.env?.(), settingSources: [], strictMcpConfig: true, mcpServers: {},
        tools: TOOLS, permissionMode: 'default', persistSession: true, verbatimPrompts: true,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: 'Respond in Hebrew. Follow project instructions. Never merge, deploy, publish or message others without explicit user instruction. This session is controlled by JARVIS; report what was actually verified.' },
        abortController: abort,
        hooks: { PreToolUse: [{ hooks: [async (event) => {
          if (event.hook_event_name !== 'PreToolUse' || !run) return { continue: false };
          const result = await this.authorize(run, event.tool_name, event.tool_input).catch(() => false);
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: result ? 'allow' : 'deny', permissionDecisionReason: result ? 'Approved by Roamies safety policy' : 'הפעולה לא אושרה בג׳ארוויס.' } };
        }] }] },
        canUseTool: async () => ({ behavior: 'deny', message: 'הפעולה חייבת לעבור דרך בדיקת הבטיחות של ג׳ארוויס.' }),
      } });
      run = { id, title: redactClaudeText(title).slice(0, 160) || 'סשן Claude', cwd, input, query, abort,
        pending: [], state: 'starting', lastReply: '' };
      this.runs.set(id, run);
      input.push(text);
      run.done = this.consume(run);
      while (this.runs.size > 100) {
        const old = [...this.runs.values()].find((item) => item !== run && ['stopped', 'failed'].includes(item.state));
        if (!old) break;
        this.runs.delete(old.id);
      }
      return this.snapshot(run);
    } finally { this.launching.delete(id); }
  }
  private async authorize(run: Run, name: string, input: unknown): Promise<boolean> {
    if (run.abort.signal.aborted || !this.options.allowActions() || !TOOLS.includes(name)
      || typeof input !== 'object' || input === null) return false;
    const args = input as Record<string, unknown>;
    let verdict: { level: string; reason?: string };
    let target: string;
    if (name === 'Bash') {
      if (typeof args.command !== 'string') return false;
      target = args.command;
      verdict = classifyCommand(target, homedir());
    } else {
      const raw = args.file_path ?? args.path ?? run.cwd;
      if (typeof raw !== 'string') return false;
      target = resolve(run.cwd, raw);
      const resolved = existsSync(target) ? await realpath(target) : resolve(await realpath(dirname(target)), target.split('/').at(-1)!);
      const rel = relative(run.cwd, resolved);
      if (rel.startsWith('..') || isAbsolute(rel)) return false;
      verdict = name === 'Edit' || name === 'Write' ? checkWrite(target, homedir(), { exists: existsSync(target) })
        : checkRead(target, homedir(), { recursive: name === 'Glob' || name === 'Grep' });
    }
    if (verdict.level === BLOCK) return false;
    if (verdict.level !== SAFE || ['Bash', 'Edit', 'Write'].includes(name)) {
      run.state = 'waiting';
      try {
        if (!await this.options.confirm(`סשן ״${run.title}״ מבקש ${name}:\n${redactClaudeText(target)}\nלאשר?`, run.abort.signal)) return false;
      } finally { if (!run.abort.signal.aborted) run.state = 'running'; }
    }
    return !run.abort.signal.aborted && this.options.allowActions();
  }
  private async consume(run: Run): Promise<void> {
    try {
      for await (const message of run.query) {
        if (run.abort.signal.aborted) break;
        if ('session_id' in message && message.session_id !== run.id) throw new ClaudeRunError('Claude החזיר מזהה שיחה שונה; ההרצה נעצרה.');
        this.receive(run, message);
      }
      if (!run.abort.signal.aborted) { run.state = 'failed'; run.error = 'החיבור ל-Claude נסגר. אפשר להמשיך מההיסטוריה.'; }
    } catch { if (!run.abort.signal.aborted) { run.state = 'failed'; run.error = 'הרצת Claude נכשלה. בדוק את ההתחברות ונסה להמשיך.'; } }
    finally { run.input.close(); run.pending.length = 0; run.query.close(); }
  }
  private receive(run: Run, message: SDKMessage): void {
    if (message.type === 'system' && message.subtype === 'init') run.state = 'running';
    if (message.type === 'assistant') run.lastReply = redactClaudeText(message.message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')).slice(-8000);
    if (message.type === 'result') {
      if (message.is_error) { run.state = 'failed'; run.error = 'Claude דיווח שההוראה נכשלה.'; run.pending.length = 0; run.abort.abort(); run.input.close(); run.query.close(); return; }
      const next = run.pending.shift();
      run.state = next ? 'running' : 'idle';
      if (next) run.input.push(next);
    }
  }
  send(id: string, text: string): ClaudeRunSnapshot {
    this.enabled(); text = this.prompt(text);
    const run = this.owned(id);
    if (['stopped', 'failed'].includes(run.state)) throw new ClaudeRunError('הסשן נעצר; יש לבקש להמשיך אותו.');
    if (run.pending.length >= 10) throw new ClaudeRunError('תור ההוראות מלא.');
    if (run.state === 'idle') { run.state = 'running'; run.input.push(text); }
    else run.pending.push(text);
    return this.snapshot(run);
  }
  stop(id: string): ClaudeRunSnapshot {
    const run = this.owned(id);
    run.state = 'stopped'; run.pending.length = 0; run.abort.abort(); run.input.close(); run.query.close();
    return this.snapshot(run);
  }
  close(): void { for (const id of this.runs.keys()) this.stop(id); }
}

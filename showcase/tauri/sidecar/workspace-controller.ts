import { z } from 'zod';
import { ClaudeSessionsService } from './claude-sessions.service.js';
import { ClaudeHooksService } from './claude-hooks.service.js';
import type { ClaudeSessionList, ClaudeTranscript } from './claude-sessions.types.js';

const request = z.object({ action: z.enum(['sessions.list', 'sessions.read', 'sessions.handoff', 'sessions.fork', 'sessions.observe']), query: z.string().max(200).optional(), id: z.string().max(100).optional() });
export interface WorkspaceState extends ClaudeSessionList {
  readonly selected?: ClaudeTranscript;
  readonly handoff?: string;
  readonly busy?: boolean;
  readonly error?: string;
  readonly observing?: boolean;
}
export class WorkspaceController {
  private current: WorkspaceState = { available: true, sessions: [] };
  constructor(private readonly sessions: ClaudeSessionsService, private readonly changed: () => void, private readonly hooks?: ClaudeHooksService) {}
  snapshot(): WorkspaceState { return this.current; }
  async handle(value: unknown): Promise<void> {
    if (this.current.busy) return;
    const parsed = request.safeParse(value);
    if (!parsed.success) return;
    const input = parsed.data;
    this.current = { ...this.current, busy: true, error: undefined }; this.changed();
    try {
      if (input.action === 'sessions.list') this.current = { ...this.current, ...await this.sessions.list({ query: input.query }), observing: (await this.hooks?.status())?.installed };
      else if (input.action === 'sessions.observe' && this.hooks) { await this.hooks.install(); this.current = { ...this.current, observing: true, message: 'המעקב הופעל. שיחות Claude חדשות ישלחו אירועי מצב בלבד.' }; }
      else if (input.id) {
        if (input.action === 'sessions.read') this.current = { ...this.current, selected: await this.sessions.read(input.id), handoff: undefined };
        if (input.action === 'sessions.handoff') this.current = { ...this.current, handoff: (await this.sessions.handoff(input.id)).text };
        if (input.action === 'sessions.fork') {
          const fork = await this.sessions.fork(input.id);
          this.current = { ...this.current, ...await this.sessions.list(), handoff: `נוצר עותק עצמאי של השיחה: ${fork.id}\nפרויקט: ${fork.cwd}\nהעותק אינו מריץ משימה. אפשר לפתוח אותו ב-Claude באמצעות claude --resume ${fork.id}` };
        }
      }
    } catch (error) { this.current = { ...this.current, error: error instanceof Error ? error.message : 'לא ניתן להשלים את הפעולה.' }; }
    finally { this.current = { ...this.current, busy: false }; this.changed(); }
  }
}

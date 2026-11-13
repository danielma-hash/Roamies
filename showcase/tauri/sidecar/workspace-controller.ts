import { z } from 'zod';
import { ClaudeSessionsService } from './claude-sessions.service.js';
import { ClaudeHooksService } from './claude-hooks.service.js';
import { AsmMemoryService } from './asm-memory.service.js';
import type { AsmMemoryCitation } from './asm-memory.types.js';
import { TaskCardsService } from './task-cards.service.js';
import type { TaskCard } from './task-cards.service.js';
import type { ClaudeSessionList, ClaudeTranscript } from './claude-sessions.types.js';

const request = z.object({ action: z.enum(['sessions.list', 'sessions.read', 'sessions.handoff', 'sessions.fork', 'sessions.observe', 'memory.search','tasks.add','tasks.refresh']), query: z.string().max(200).optional(), id: z.string().max(100).optional(), scope: z.enum(['company','personal']).optional(), url:z.string().max(1000).optional(),monday:z.string().max(1000).optional() });
export interface WorkspaceState extends ClaudeSessionList {
  readonly selected?: ClaudeTranscript;
  readonly handoff?: string;
  readonly busy?: boolean;
  readonly error?: string;
  readonly observing?: boolean;
  readonly citations?: readonly AsmMemoryCitation[];
  readonly cards?: readonly TaskCard[];
}
export class WorkspaceController {
  private current: WorkspaceState = { available: true, sessions: [] };
  constructor(private readonly sessions: ClaudeSessionsService, private readonly changed: () => void, private readonly hooks?: ClaudeHooksService, private readonly memory?: AsmMemoryService, private readonly tasks?: TaskCardsService) {}
  async initialize():Promise<void>{try{await this.tasks?.load();this.current={...this.current,cards:this.tasks?.list()??[]};}catch(error){this.current={...this.current,error:error instanceof Error?error.message:'טעינת מרכז העבודה נכשלה.'};}this.changed();}
  snapshot(): WorkspaceState { return this.current; }
  async handle(value: unknown): Promise<void> {
    if (this.current.busy) return;
    const parsed = request.safeParse(value);
    if (!parsed.success) return;
    const input = parsed.data;
    this.current = { ...this.current, busy: true, error: undefined }; this.changed();
    try {
      if ((input.action==='tasks.add'||input.action==='tasks.refresh')&&input.url&&this.tasks){this.current={...this.current,cards:await this.tasks.track(input.url,input.monday)};return;}
      if (input.action === 'memory.search' && input.scope && this.memory) { this.current = { ...this.current, citations: await this.memory.search(input.query ?? '', { scope: input.scope }) }; return; }
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

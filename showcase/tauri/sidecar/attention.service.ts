import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AttentionEvent, AttentionKind, AttentionOptions, AttentionPreferences, AttentionSnapshot } from './attention.types.js';
import type { ClaudeSession } from './claude-sessions.types.js';
import type { TaskCard } from './task-cards.service.js';

const preferencesSchema = z.object({ quiet: z.boolean(), focus: z.boolean() });
const eventSchema = z.object({
  id: z.string().max(100), kind: z.enum(['session-waiting', 'session-ended', 'checks-failed', 'checks-passed']),
  sourceId: z.string().max(1000), title: z.string().max(240), createdAt: z.number().finite(),
  url: z.string().max(1000).optional(), dismissedAt: z.number().finite().optional(),
});
const stateSchema = z.object({
  version: z.literal(1), preferences: preferencesSchema, events: z.array(eventSchema).max(100),
  observations: z.record(z.string(), z.object({
    status: z.enum(['running', 'waiting', 'idle', 'ended', 'unknown', 'pending', 'failure', 'success']),
    revision: z.number().int().nonnegative(),
  })),
});

export class AttentionError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'AttentionError'; }
}

/** A durable local inbox. Quiet/focus affect delivery only; unread events remain available. */
export class AttentionService {
  private readonly filePath: string;
  private readonly now: () => number;
  private state: z.infer<typeof stateSchema> | undefined;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: AttentionOptions) {
    this.filePath = options.filePath;
    this.now = options.now ?? Date.now;
  }

  async snapshot(): Promise<AttentionSnapshot> {
    return this.serial(async () => {
      const state = await this.load();
      return structuredClone({ preferences: state.preferences, events: state.events, unread: state.events.filter((event) => event.dismissedAt === undefined).length });
    });
  }

  async setPreferences(preferences: Partial<AttentionPreferences>): Promise<void> {
    return this.serial(async () => {
      const next = structuredClone(await this.load());
      next.preferences = preferencesSchema.parse({ ...next.preferences, ...preferences });
      await this.save(next);
    });
  }

  async dismiss(id: string): Promise<boolean> {
    return this.serial(async () => {
      const next = structuredClone(await this.load());
      const event = next.events.find((item) => item.id === id);
      if (!event || event.dismissedAt !== undefined) return false;
      event.dismissedAt = this.now();
      await this.save(next);
      return true;
    });
  }

  async update(sessions: readonly ClaudeSession[], cards: readonly TaskCard[]): Promise<readonly AttentionEvent[]> {
    return this.serial(async () => {
      const next = structuredClone(await this.load());
      const added: AttentionEvent[] = [];
      const observe = (source: 'session' | 'checks', sourceId: string, title: string,
        status: z.infer<typeof stateSchema>['observations'][string]['status'], url?: string) => {
        if (!sourceId || sourceId.length > 1000) return;
        const key = `${source}:${sourceId}`;
        const previous = next.observations[key];
        // Missing status is not evidence that work finished or a check recovered.
        if (previous && (status === 'unknown' || previous.status === status)) return;
        const revision = (previous?.revision ?? 0) + 1;
        delete next.observations[key];
        next.observations[key] = { status, revision };
        // The first observation of each item establishes a silent baseline.
        if (!previous) return;
        let kind: AttentionKind | undefined;
        if (source === 'session' && status === 'waiting') kind = 'session-waiting';
        if (source === 'session' && status === 'ended') kind = 'session-ended';
        if (source === 'checks' && status === 'failure') kind = 'checks-failed';
        if (source === 'checks' && status === 'success' && ['pending', 'failure'].includes(previous.status)) kind = 'checks-passed';
        if (!kind) return;
        const id = createHash('sha256').update(`${key}:${revision}:${status}`).digest('hex');
        const event: AttentionEvent = { id, kind, sourceId, title: title.slice(0, 240), createdAt: this.now(), ...(url ? { url } : {}) };
        if (!next.events.some((item) => item.id === id)) { next.events.push(event); added.push(event); }
      };
      for (const session of sessions) observe('session', session.id, session.title, session.status);
      for (const card of cards) observe('checks', card.url, card.title, this.checkStatus(card), card.url);
      next.events = next.events.slice(-100);
      // Bound the persisted baseline as well as the inbox. Evicted items return silently.
      next.observations = Object.fromEntries(Object.entries(next.observations).slice(-1000));
      if (JSON.stringify(next) !== JSON.stringify(this.state)) await this.save(next);
      return next.preferences.quiet || next.preferences.focus ? [] : structuredClone(added.slice(-100));
    });
  }

  private checkStatus(card: TaskCard): 'unknown' | 'pending' | 'failure' | 'success' {
    const checks = card.statusCheckRollup;
    if (!checks?.length) return 'unknown';
    const states = checks.map((check) => (check.conclusion || check.state || check.status || '').toUpperCase());
    if (states.some((state) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(state))) return 'failure';
    if (states.some((state) => ['PENDING', 'QUEUED', 'IN_PROGRESS', 'REQUESTED', 'WAITING'].includes(state))) return 'pending';
    return states.every((state) => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(state)) ? 'success' : 'unknown';
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async load(): Promise<z.infer<typeof stateSchema>> {
    if (this.state) return this.state;
    try {
      const handle = await fs.open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new AttentionError('קובץ ההתראות אינו תקין או גדול מדי.');
        const data = Buffer.alloc(stat.size + 1);
        const { bytesRead } = await handle.read(data, 0, data.length, 0);
        if (bytesRead > stat.size) throw new AttentionError('קובץ ההתראות השתנה בזמן הקריאה.');
        this.state = stateSchema.parse(JSON.parse(data.toString('utf8', 0, bytesRead)));
      } finally { await handle.close(); }
    } catch (error: unknown) {
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        this.state = { version: 1, preferences: { quiet: false, focus: false }, events: [], observations: {} };
      } else throw new AttentionError('לא ניתן לקרוא את ההתראות השמורות. הקובץ לא שונה.', { cause: error });
    }
    return this.state;
  }

  private async save(next: z.infer<typeof stateSchema>): Promise<void> {
    const validated = stateSchema.parse(next);
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(validated)); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(temporary, this.filePath);
      this.state = validated;
    } catch (error: unknown) {
      throw new AttentionError('שמירת ההתראות נכשלה; השינוי לא נשמר.', { cause: error });
    } finally { await fs.unlink(temporary).catch(() => undefined); }
  }
}

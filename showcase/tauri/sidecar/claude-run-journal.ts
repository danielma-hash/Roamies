import { constants } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ClaudeRunSnapshot } from './claude-run.types.js';

const record = z.object({
  id: z.string().uuid(), title: z.string().max(160), cwd: z.string().max(4096),
  state: z.enum(['starting', 'running', 'waiting', 'idle', 'stopped', 'failed', 'interrupted']),
  queued: z.number().int().min(0).max(10), lastReply: z.string().max(8000),
  error: z.string().max(1000).optional(), updatedAt: z.number().finite().nonnegative().optional(),
  recoveryInstructions: z.array(z.string().max(12_000)).max(11).optional(),
  projectContext: z.object({
    root: z.string().max(4096), digest: z.string().regex(/^[a-f0-9]{64}$/), loadedAt: z.number().finite().nonnegative(),
    sources: z.array(z.object({ path: z.string().max(4096), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(0).max(32 * 1024) })).max(24),
  }).optional(),
});
const journal = z.object({ version: z.literal(1), runs: z.array(record).max(100) });
const MAX_BYTES = 64 * 1024 * 1024;

export class ClaudeJournalError extends Error {
  constructor() { super('לא ניתן לקרוא או לשמור את התקדמות הסשנים. הקובץ נשמר ללא איפוס; ניהול סשנים חדשים חסום עד לתיקון.'); this.name = 'ClaudeJournalError'; }
}

/** Atomic private snapshots. Recovery is data only, never a replay queue. */
export class ClaudeRunJournal {
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly file: string) {}

  async load(): Promise<readonly ClaudeRunSnapshot[]> {
    try {
      const handle = await open(this.file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_BYTES) throw new ClaudeJournalError();
        const buffer = Buffer.alloc(stat.size + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > stat.size) throw new ClaudeJournalError();
        const parsed = journal.parse(JSON.parse(buffer.toString('utf8', 0, bytesRead)));
        if (new Set(parsed.runs.map((run) => run.id)).size !== parsed.runs.length) throw new ClaudeJournalError();
        return parsed.runs.map((run) => ['stopped', 'failed'].includes(run.state) ? run : {
          ...run, state: 'interrupted' as const, error: 'החיבור הקודם נסגר. ההוראות השמורות הן לעיון בלבד; יש לבדוק מה בוצע לפני המשך.',
        });
      } finally { await handle.close(); }
    } catch (error: unknown) {
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
      throw new ClaudeJournalError();
    }
  }

  async save(runs: readonly ClaudeRunSnapshot[]): Promise<void> {
    // Snapshot now, not when an earlier write settles.
    const body = JSON.stringify(journal.parse({ version: 1, runs }));
    const write = async (): Promise<void> => {
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, this.file);
      } catch { throw new ClaudeJournalError(); }
      finally { await unlink(temporary).catch(() => undefined); }
    };
    const result = this.writes.then(write);
    this.writes = result;
    // A failed journal remains failed, rather than acknowledging later writes.
    void result.catch(() => undefined);
    return result;
  }
}

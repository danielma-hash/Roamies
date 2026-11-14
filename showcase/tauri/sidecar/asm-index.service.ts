import { open, lstat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import path from 'node:path';
import type { AsmIndexSnapshot } from './asm-index.types.js';

const FILES = ['brain.json', 'memory.jsonl', 'lifecycle.jsonl'] as const;
const signature = (stat: BigIntStats): string => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const missing = (error: unknown): boolean => object(error) && error.code === 'ENOENT';
const rows = (value: string, strict = false): Record<string, unknown>[] => value.split('\n').flatMap((line) => {
  if (!line.trim()) return [];
  try { const row: unknown = JSON.parse(line); return object(row) ? [row] : []; }
  catch { if (strict) throw new AsmIndexError('יומן מחזור החיים של הזיכרון אינו תקין; לא מוצגות תוצאות ישנות.'); return []; }
});
export class AsmIndexError extends Error { override readonly name = 'AsmIndexError'; }

/** Checks secure file identities on every call; reads/parses content only when identities change. */
export class AsmIndexService {
  private cache?: { readonly signatures: readonly string[]; readonly snapshot: AsmIndexSnapshot };
  private pending?: Promise<AsmIndexSnapshot>;
  private revision = 0;
  constructor(private readonly root: string, private readonly maxFileBytes: number) {}
  snapshot(): Promise<AsmIndexSnapshot> {
    if (this.pending) return this.pending;
    const pending = this.load().finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending; return pending;
  }
  private async load(): Promise<AsmIndexSnapshot> {
    const handles: (FileHandle | undefined)[] = []; const stats: (BigIntStats | undefined)[] = [];
    try {
      for (const file of FILES) {
        let handle: FileHandle | undefined;
        try { handle = await open(path.join(this.root, file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
        catch (error) { if (!missing(error)) throw error; }
        handles.push(handle);
        const stat = await handle?.stat({ bigint: true });
        if (stat && (!stat.isFile() || stat.size > BigInt(this.maxFileBytes))) throw new AsmIndexError('מקור הזיכרון אינו קובץ רגיל או חורג ממגבלת הגודל.');
        stats.push(stat);
      }
      const signatures = stats.map((stat) => stat ? signature(stat) : 'missing');
      const absent = stats.filter((stat) => !stat).length;
      // Never interpret a deleted lifecycle ledger as permission to resurrect retired memories.
      if (absent && (absent !== FILES.length || this.cache?.signatures.some((value) => value !== 'missing'))) throw new AsmIndexError('חסר מקור בזיכרון המשותף; לא מוצגות תוצאות ישנות.');
      if (this.cache && signatures.every((value, i) => value === this.cache?.signatures[i])) return this.cache.snapshot;
      const texts: string[] = [];
      for (const [i, handle] of handles.entries()) {
        if (!handle) { texts.push(''); continue; }
        const size = Number(stats[i]!.size); const buffer = Buffer.alloc(size + 1); let count = 0;
        while (count < buffer.length) {
          const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
          if (!bytesRead) break; count += bytesRead;
        }
        if (count !== size || signature(await handle.stat({ bigint: true })) !== signatures[i]) throw new AsmIndexError('הזיכרון השתנה בזמן הרענון; יש לנסות שוב.');
        texts.push(buffer.toString('utf8', 0, count));
      }
      // Detect atomic replacements while another source was being read.
      for (const [i, file] of FILES.entries()) {
        let stat: BigIntStats | undefined;
        try { stat = await lstat(path.join(this.root, file), { bigint: true }); } catch (error) { if (!missing(error)) throw error; }
        if ((stat ? signature(stat) : 'missing') !== signatures[i]) throw new AsmIndexError('מקורות הזיכרון השתנו בזמן הרענון; יש לנסות שוב.');
      }
      const brain: unknown = texts[0] ? JSON.parse(texts[0]) : { nodes: [] };
      if (!object(brain)) throw new AsmIndexError('אינדקס הזיכרון אינו תקין.');
      const snapshot: AsmIndexSnapshot = { revision: ++this.revision, nodes: Array.isArray(brain.nodes) ? brain.nodes.filter(object) : [], memories: rows(texts[1]), operations: rows(texts[2], true) };
      this.cache = { signatures, snapshot }; return snapshot;
    } catch (error) {
      // Keep identities to detect disappearing sources, but never return cached content on failure.
      if (error instanceof AsmIndexError) throw error;
      throw new AsmIndexError('לא ניתן לרענן את הזיכרון המשותף. בדוק זמינות והרשאות; לא מוצגות תוצאות ישנות.');
    } finally { await Promise.allSettled(handles.map((handle) => handle?.close())); }
  }
}

import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PronunciationDictionaryOptions, PronunciationEntry, PronunciationPreview } from './pronunciation-dictionary.types.js';

const MAX_ENTRIES = 100;
const quotePattern = (term: string): string => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const key = (term: string): string => term.normalize('NFC').replace(/[׳’]/g, "'").toLocaleLowerCase();

export class PronunciationDictionaryError extends Error {
  constructor(message: string) { super(message); this.name = 'PronunciationDictionaryError'; }
}

function entry(value: unknown): PronunciationEntry {
  if (typeof value !== 'object' || value === null || !('term' in value) || !('replacement' in value)
    || typeof value.term !== 'string' || typeof value.replacement !== 'string') throw new PronunciationDictionaryError('יש להזין מונח וצורת הגייה.');
  const term = value.term.normalize('NFC').trim().replace(/ +/g, ' ');
  const replacement = value.replacement.normalize('NFC').trim().replace(/ +/g, ' ');
  if (!term || term.length > 80 || /[\x00-\x1f\x7f<>`\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(term)
    || !replacement || replacement.length > 160
    || !/^[\p{L}\p{M}\p{N} .,!?;:'"׳״’()־–—+\-/&]+$/u.test(replacement)) {
    throw new PronunciationDictionaryError('יש להשתמש במונח קצר ובהגייה כטקסט רגיל, ללא תגיות או הוראות קול.');
  }
  return { term, replacement };
}

/** Local speech-only overrides. Never apply this dictionary to chat, memory or model prompts. */
export class PronunciationDictionaryService {
  private entries: readonly PronunciationEntry[] = [];
  private pattern?: RegExp;
  private readonly replacements = new Map<string, string>();
  private pending = Promise.resolve();
  private loadWarning?: string;

  constructor(private readonly options: PronunciationDictionaryOptions) {}

  get warning(): string | undefined { return this.loadWarning; }

  list(): readonly PronunciationEntry[] { return this.entries.map((item) => ({ ...item })); }

  async load(): Promise<readonly PronunciationEntry[]> {
    try {
      const file = await open(this.options.filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let value: unknown;
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > 128 * 1024) throw new PronunciationDictionaryError('קובץ מילון ההגייה גדול מדי.');
        value = JSON.parse(await file.readFile('utf8')) as unknown;
      } finally { await file.close(); }
      if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1
        || !('entries' in value) || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) {
        throw new PronunciationDictionaryError('מבנה מילון ההגייה אינו תקין.');
      }
      const entries = value.entries.map((item: unknown) => entry(item));
      if (new Set(entries.map((item) => key(item.term))).size !== entries.length) throw new PronunciationDictionaryError('מילון ההגייה מכיל מונחים כפולים.');
      this.replace(entries); this.loadWarning = undefined;
    } catch (error) {
      this.replace([]);
      const absent = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
      this.loadWarning = absent ? undefined : 'מילון ההגייה לא נטען. ההגייה הרגילה תמשיך לפעול.';
    }
    return this.list();
  }

  private replace(entries: readonly PronunciationEntry[]): void {
    this.entries = entries;
    this.replacements.clear();
    for (const item of entries) this.replacements.set(key(item.term), item.replacement);
    // Literal longest match, Unicode boundaries, and Hebrew clitics. Apostrophe
    // spellings are equivalent, while unrelated parts of longer words stay intact.
    const alternatives = entries.toSorted((a, b) => b.term.length - a.term.length)
      .map((item) => quotePattern(item.term).replace(/['׳’]/g, "['׳’]")).join('|');
    this.pattern = alternatives ? new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])(ו?[בכלמהש]?[־-]?)(${alternatives})(?![\\p{L}\\p{M}\\p{N}_])`, 'giu') : undefined;
  }

  apply(text: string): string {
    if (!this.pattern) return text;
    return text.normalize('NFC').replace(this.pattern, (_whole: string, prefix: string, term: string) =>
      `${prefix}${this.replacements.get(key(term)) ?? term}`);
  }

  preview(text: string): PronunciationPreview {
    if (text.length > 4000) throw new PronunciationDictionaryError('תצוגת ההגייה מוגבלת ל־4,000 תווים.');
    return { before: text, after: this.apply(text) };
  }

  async upsert(value: PronunciationEntry): Promise<readonly PronunciationEntry[]> {
    const item = entry(value);
    return this.mutate((previous) => {
      const existing = previous.some((candidate) => key(candidate.term) === key(item.term));
      if (!existing && previous.length >= MAX_ENTRIES) throw new PronunciationDictionaryError('אפשר לשמור עד 100 מונחים במילון ההגייה.');
      return existing ? previous.map((candidate) => key(candidate.term) === key(item.term) ? item : candidate) : [...previous, item];
    });
  }

  async remove(term: string): Promise<readonly PronunciationEntry[]> {
    return this.mutate((previous) => previous.filter((item) => key(item.term) !== key(term)));
  }

  private async mutate(update: (previous: readonly PronunciationEntry[]) => readonly PronunciationEntry[]): Promise<readonly PronunciationEntry[]> {
    const operation = this.pending.then(async () => {
      const entries = update(this.entries);
      const temporary = `${this.options.filePath}.${randomUUID()}.tmp`;
      try {
        await mkdir(dirname(this.options.filePath), { recursive: true, mode: 0o700 });
        await writeFile(temporary, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        await rename(temporary, this.options.filePath);
        this.replace(entries); this.loadWarning = undefined;
      } catch (error) {
        if (error instanceof PronunciationDictionaryError) throw error;
        throw new PronunciationDictionaryError('לא ניתן לשמור כרגע את מילון ההגייה.');
      } finally { await unlink(temporary).catch(() => {}); }
    });
    this.pending = operation.catch(() => {});
    await operation;
    return this.list();
  }
}

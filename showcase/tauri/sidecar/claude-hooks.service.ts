import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'] as const;
const MARKER = "'--roamies-observer'";

export interface ClaudeHooksOptions {
  readonly settingsPath?: string;
  readonly nodePath: string;
  readonly scriptPath: string;
  /** Test seam for another settings editor writing between the initial read and final check. */
  readonly beforeCommit?: () => Promise<void>;
}

export interface ClaudeHooksStatus {
  readonly installed: boolean;
  readonly configuredEvents: number;
  readonly totalEvents: number;
}

export class ClaudeHooksError extends Error {
  constructor(message: string) { super(message); this.name = 'ClaudeHooksError'; }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function quote(value: string): string {
  if (!isAbsolute(value) || /[\x00-\x1f]/.test(value)) throw new ClaudeHooksError('נתיבי התקנת המעקב חייבים להיות נתיבים מלאים ותקינים.');
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function missing(error: unknown): boolean { return object(error) && error.code === 'ENOENT'; }

function isObserver(hook: unknown): boolean {
  return object(hook) && hook.type === 'command' && typeof hook.command === 'string'
    && hook.command.includes(` ${MARKER} `);
}

/** Install only from an explicit panel action. This class never runs Claude or changes other hooks. */
export class ClaudeHooksService {
  private readonly settingsPath: string;
  private readonly command: string;

  constructor(private readonly options: ClaudeHooksOptions) {
    this.settingsPath = options.settingsPath ?? join(homedir(), '.claude', 'settings.json');
    this.command = `${quote(options.nodePath)} ${quote(options.scriptPath)} ${MARKER} >/dev/null 2>&1`;
  }

  private async read(): Promise<string | undefined> {
    try {
      const file = await open(this.settingsPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new ClaudeHooksError('קובץ הגדרות Claude אינו מתאים לעדכון אוטומטי.');
        return await file.readFile('utf8');
      } finally { await file.close(); }
    } catch (error) { if (missing(error)) return undefined; throw error; }
  }

  private parse(raw: string | undefined): Record<string, unknown> {
    let parsed: unknown;
    try { parsed = raw === undefined ? {} : JSON.parse(raw) as unknown; }
    catch { throw new ClaudeHooksError('קובץ הגדרות Claude אינו JSON תקין; לא שונה דבר.'); }
    if (!object(parsed) || (parsed.hooks !== undefined && !object(parsed.hooks))) {
      throw new ClaudeHooksError('מבנה הגדרות Claude אינו נתמך; לא שונה דבר.');
    }
    return parsed;
  }

  private entries(config: Record<string, unknown>, event: string): unknown[] {
    const hooks = object(config.hooks) ? config.hooks : {};
    const entries = hooks[event];
    if (entries === undefined) return [];
    if (!Array.isArray(entries)) throw new ClaudeHooksError('מבנה ה-hooks הקיימים אינו נתמך; לא שונה דבר.');
    return entries;
  }

  private configured(config: Record<string, unknown>): ClaudeHooksStatus {
    let configuredEvents = 0;
    for (const event of EVENTS) {
      const has = this.entries(config, event).some((entry) => object(entry) && Array.isArray(entry.hooks)
        && (entry.matcher === undefined || entry.matcher === '' || entry.matcher === '*')
        && entry.hooks.some((hook: unknown) => isObserver(hook) && object(hook) && hook.command === this.command));
      if (has) configuredEvents++;
    }
    return { installed: configuredEvents === EVENTS.length && config.disableAllHooks !== true, configuredEvents, totalEvents: EVENTS.length };
  }

  async status(): Promise<ClaudeHooksStatus> {
    try { return this.configured(this.parse(await this.read())); }
    catch (error) {
      if (error instanceof ClaudeHooksError) throw error;
      throw new ClaudeHooksError('לא ניתן לבדוק כרגע את הגדרות המעקב של Claude.');
    }
  }

  async install(): Promise<ClaudeHooksStatus & { changed: boolean; backupPath?: string }> {
    const lockPath = `${this.settingsPath}.roamies.lock`;
    const temporary = `${this.settingsPath}.${randomUUID()}.tmp`;
    let locked = false;
    try {
      await mkdir(dirname(this.settingsPath), { recursive: true, mode: 0o700 });
      const lock = await open(lockPath, 'wx', 0o600); locked = true; await lock.close();
      const original = await this.read();
      const config = this.parse(original);
      if (config.disableAllHooks === true) throw new ClaudeHooksError('ה-hooks מושבתים בהגדרות Claude. המעקב לא הותקן.');
      if (this.configured(config).installed) return { ...this.configured(config), changed: false };
      const hooks = object(config.hooks) ? config.hooks : {};
      for (const event of EVENTS) {
        const entries = this.entries(config, event);
        // Retain every unrelated entry and hook, including hooks sharing an observer entry.
        const preserved = entries.flatMap((entry: unknown) => {
          if (!object(entry) || !Array.isArray(entry.hooks)) return [entry];
          const remaining: unknown[] = entry.hooks.filter((hook: unknown) => !isObserver(hook));
          if (remaining.length === entry.hooks.length) return [entry];
          return remaining.length ? [{ ...entry, hooks: remaining }] : [];
        });
        hooks[event] = [...preserved, { hooks: [{ type: 'command', command: this.command, timeout: 5 }] }];
      }
      config.hooks = hooks;
      await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      await this.options.beforeCommit?.();
      if (await this.read() !== original) throw new ClaudeHooksError('הגדרות Claude השתנו במקביל. לא נדרסו שינויים; יש לנסות שוב.');
      let backupPath: string | undefined;
      if (original !== undefined) {
        backupPath = `${this.settingsPath}.roamies-backup-${randomUUID()}.json`;
        await writeFile(backupPath, original, { flag: 'wx', mode: 0o600 });
      }
      // Recheck after backup I/O, immediately before the atomic replacement.
      if (await this.read() !== original) throw new ClaudeHooksError('הגדרות Claude השתנו במקביל. לא נדרסו שינויים; יש לנסות שוב.');
      await rename(temporary, this.settingsPath);
      return { ...this.configured(config), changed: true, ...(backupPath ? { backupPath } : {}) };
    } catch (error) {
      if (error instanceof ClaudeHooksError) throw error;
      if (object(error) && error.code === 'EEXIST') throw new ClaudeHooksError('עדכון הגדרות Claude כבר מתבצע. יש לנסות שוב לאחר שיסתיים.');
      throw new ClaudeHooksError('לא ניתן להתקין כרגע את המעקב אחר שיחות Claude.');
    } finally {
      await unlink(temporary).catch(() => {});
      if (locked) await unlink(lockPath).catch(() => {});
    }
  }
}

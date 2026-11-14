import { execFile } from 'node:child_process';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

export class DesktopProcessError extends Error { override readonly name = 'DesktopProcessError'; }
/** Fixed, app-bundled executable; no shell or inherited provider credentials. */
export class DesktopProcessService {
  private state: Promise<string> | undefined;
  private readonly shutdown = new AbortController();
  constructor(private readonly binary: string, private readonly helper: string) {}
  async run(args: readonly string[], input?: string, signal?: AbortSignal): Promise<unknown> {
    const combined = signal ? AbortSignal.any([signal, this.shutdown.signal]) : this.shutdown.signal;
    combined.throwIfAborted();
    this.state ??= mkdtemp(path.join(tmpdir(), 'roamies-desktop-')).then(async (dir) => { await chmod(dir, 0o700); return dir; });
    const home = await this.state; combined.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = execFile(this.binary, [...args], { timeout: 12_000, maxBuffer: 512_000, encoding: 'utf8', signal: combined,
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: homedir(), TMPDIR: tmpdir(), AGENT_DESKTOP_HOME: home, AGENT_DESKTOP_MACOS_HELPER_PATH: this.helper } },
      (error, stdout) => {
        // Never retry: a failed/timed-out client may already have delivered the action.
        if (error) { reject(new DesktopProcessError('הכלי לא השלים את הבקשה; ייתכן שהפעולה נמסרה. יש לקרוא את החלון לפני ניסיון נוסף.')); return; }
        try { resolve(JSON.parse(stdout)); } catch { reject(new DesktopProcessError('agent-desktop החזיר תשובה לא תקינה.')); }
      });
      child.stdin?.on('error', () => { /* execFile callback handles process failure */ });
      child.stdin?.end(input);
    });
  }
  async close(): Promise<void> { this.shutdown.abort(); if (this.state) await rm(await this.state, { recursive: true, force: true }); }
}

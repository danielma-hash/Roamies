import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseClaudeEvent } from './claude-sessions.service.js';
import type { ClaudeEventOptions } from './claude-sessions.types.js';

/** Persist a strict allowlist: no prompt, transcript path, notification text or tool arguments. */
export async function collectClaudeEvent(input: unknown, options: ClaudeEventOptions = {}): Promise<boolean> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const hook = input as Record<string, unknown>;
  const event = parseClaudeEvent({ sessionId: hook.session_id, cwd: hook.cwd, event: hook.hook_event_name,
    timestamp: (options.now ?? Date.now)(), ...(hook.pid !== undefined ? { pid: hook.pid } : {}) });
  if (!event) return false;
  const directory = options.directory ?? join(homedir(), '.gg', 'sidekick', 'claude-events');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) return false;
  await chmod(directory, 0o700);
  const target = join(directory, `${event.sessionId}.json`);
  const temporary = join(directory, `${event.sessionId}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(event), { mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
  } finally { await unlink(temporary).catch(() => {}); }
  return true;
}

/** Bundle as a separate CLI entry and invoke this function; imports have no side effects. */
export async function runClaudeEventsCli(input: AsyncIterable<Uint8Array | string> = process.stdin): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of input) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 1024 * 1024) return;
      chunks.push(buffer);
    }
    await collectClaudeEvent(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
  } catch { /* An optional observer must never block a Claude hook or expose its input. */ }
}

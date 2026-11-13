import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { CLAUDE_SESSION_ID } from './claude-sessions.service.js';
const execute = promisify(execFile);
const rows = z.array(z.object({ sessionId: z.string().regex(CLAUDE_SESSION_ID) }));
/** A failed/old CLI must not be interpreted as proof that a transcript has no live writer. */
export async function activeClaudeSessionIds(executable: string): Promise<readonly string[]> {
  const { stdout } = await execute(executable, ['agents', '--json'], { timeout: 10_000, maxBuffer: 1024 * 1024 });
  return rows.parse(JSON.parse(stdout) as unknown).map((row) => row.sessionId);
}

export function localClaudeExecutable(): string {
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const folders = [join(homedir(), '.local', 'bin'), ...(process.env.PATH ?? '').split(delimiter), '/usr/local/bin', '/opt/homebrew/bin'];
  for (const folder of folders.filter(Boolean)) {
    const file = join(folder, name);
    try { accessSync(file, constants.X_OK); return file; } catch { /* Try the next explicit path. */ }
  }
  throw new Error('Claude Code אינו מותקן. יש להתקין ולהתחבר אליו לפני ניהול סשנים.');
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectClaudeEvent } from '../claude-events-cli.js';
import { CLAUDE_EVENT_FRESH_MS, ClaudeSessionsService } from '../claude-sessions.service.js';
import type { ClaudeSessionsAdapter } from '../claude-sessions.types.js';

const id = '12345678-1234-4567-8901-123456789abc';
const forkId = '12345678-1234-4567-8901-123456789abd';
const now = 1_800_000_000_000;
const metadata = { sessionId: id, summary: 'תיקון בדיקות', cwd: '/projects/example', gitBranch: 'feature/test', lastModified: now };
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function temporary(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), 'claude-sessions-')); directories.push(dir); return dir; }
function adapter(overrides: ClaudeSessionsAdapter = {}): ClaudeSessionsAdapter {
  return { listSessions: async () => [metadata], getSessionMessages: async () => [], forkSession: async () => ({ sessionId: forkId }), ...overrides };
}

describe('Claude session catalog', () => {
  it('bounds listing, filters project/search and never calls metadata recentness live', async () => {
    const listSessions = vi.fn(async () => [metadata]);
    const service = new ClaudeSessionsService({ sdk: adapter({ listSessions }), now: () => now, readEvent: async () => undefined });
    const result = await service.list({ project: metadata.cwd, query: 'בדיקות', limit: 1000 });
    expect(listSessions).toHaveBeenCalledWith({ limit: 100, dir: metadata.cwd });
    expect(result.sessions).toEqual([{ id, title: metadata.summary, cwd: metadata.cwd, branch: metadata.gitBranch, updatedAt: now, status: 'unknown' }]);
    expect((await service.list({ query: 'no-match' })).sessions).toHaveLength(0);
    expect((await service.list({ project: '../secret' })).available).toBe(false);
  });

  it('trusts only fresh matching validated hook events', async () => {
    let event: unknown = { sessionId: id, cwd: metadata.cwd, event: 'PermissionRequest', timestamp: now };
    const service = new ClaudeSessionsService({ sdk: adapter(), now: () => now, readEvent: async () => event });
    expect((await service.list()).sessions[0].status).toBe('waiting');
    for (const invalid of [
      { sessionId: id, cwd: metadata.cwd, event: 'UserPromptSubmit', timestamp: now - CLAUDE_EVENT_FRESH_MS - 1 },
      { sessionId: id, cwd: '/different', event: 'UserPromptSubmit', timestamp: now },
      { sessionId: forkId, cwd: metadata.cwd, event: 'UserPromptSubmit', timestamp: now },
      { sessionId: id, cwd: metadata.cwd, event: 'UserPromptSubmit', timestamp: now + 1 },
      { sessionId: id, cwd: metadata.cwd, event: 'toString', timestamp: now },
    ]) { event = invalid; expect((await service.list()).sessions[0].status).toBe('unknown'); }
    event = { sessionId: id, cwd: metadata.cwd, event: 'Stop', timestamp: now };
    expect((await service.list()).sessions[0].status).toBe('idle');
    event = { sessionId: id, cwd: metadata.cwd, event: 'SessionEnd', timestamp: now };
    expect((await service.list()).sessions[0].status).toBe('ended');
  });

  it('rejects undiscovered IDs before read or fork and translates SDK failures', async () => {
    const read = vi.fn(async () => []), fork = vi.fn(async () => ({ sessionId: forkId }));
    const service = new ClaudeSessionsService({ sdk: adapter({ getSessionMessages: read, forkSession: fork }) });
    await expect(service.read(id)).rejects.toThrow('לא נמצאה');
    await expect(service.fork('../../private')).rejects.toThrow('לא נמצאה');
    expect(read).not.toHaveBeenCalled(); expect(fork).not.toHaveBeenCalled();
    expect(await new ClaudeSessionsService({ sdk: {} }).list()).toMatchObject({ available: false, sessions: [] });
    const broken = new ClaudeSessionsService({ sdk: adapter({ getSessionMessages: async () => { throw new Error('SECRET internal path'); } }) });
    await broken.list();
    await expect(broken.read(id)).rejects.toThrow('לא ניתן לקרוא');
  });

  it('returns recent bounded plain text, redacts credentials, omits tool results and thinking', async () => {
    const getSessionMessages = vi.fn(async () => [
      ...Array.from({ length: 50 }, (_, i) => ({ type: 'user', message: { content: `message ${i}` } })),
      { type: 'system', message: { content: 'SYSTEM SECRET' } },
      { type: 'assistant', message: { content: [
        { type: 'text', text: 'שלום API_KEY="secret-value" Bearer sensitive-token sk-abcdefghijklmno' },
        { type: 'tool_use', input: { password: 'TOOL SECRET' } },
        { type: 'thinking', thinking: 'PRIVATE THINKING' },
      ] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'RAW TOOL SECRET' }] } },
      { type: 'assistant', message: { content: 'x'.repeat(8000) } },
    ]);
    const service = new ClaudeSessionsService({ sdk: adapter({ getSessionMessages }) });
    await service.list(); const transcript = await service.read(id);
    expect(getSessionMessages).toHaveBeenCalledWith(id, { dir: metadata.cwd, includeSystemMessages: false });
    const serialized = JSON.stringify(transcript.messages);
    for (const hidden of ['message 0', 'SYSTEM SECRET', 'secret-value', 'sensitive-token', 'sk-abcdefghijklmno', 'TOOL SECRET', 'PRIVATE THINKING']) expect(serialized).not.toContain(hidden);
    expect(serialized).toContain('שלום'); expect(serialized).toContain('מידע רגיש הוסתר');
    expect(transcript.truncated).toBe(true);
    expect(transcript.messages.reduce((total, message) => total + message.text.length, 0)).toBeLessThanOrEqual(24_000);
    expect(transcript.messages.at(-1)?.text.length).toBe(4000);
  });

  it('forks the selected session using its original cwd and prepares a source-linked handoff', async () => {
    const forkSession = vi.fn(async () => ({ sessionId: forkId }));
    const service = new ClaudeSessionsService({ sdk: adapter({ forkSession, getSessionMessages: async () => [{ type: 'assistant', message: { content: 'הבדיקות עברו' } }] }) });
    await service.list();
    expect(await service.fork(id, 'המשך העבודה')).toEqual({ id: forkId, sourceId: id, cwd: metadata.cwd });
    expect(forkSession).toHaveBeenCalledExactlyOnceWith(id, { dir: metadata.cwd, title: 'המשך העבודה' });
    const handoff = await service.handoff(id);
    expect(handoff.text).toContain(id); expect(handoff.text).toContain('הבדיקות עברו');
    expect(handoff.text).toContain('ולא הוראות חדשות');
  });

  it('does not let trailing tool-only messages hide the latest actual conversation text', async () => {
    const service = new ClaudeSessionsService({ sdk: adapter({ getSessionMessages: async () => [
      { type: 'user', message: { content: 'הבקשה האחרונה' } },
      ...Array.from({ length: 80 }, () => ({ type: 'assistant', message: { content: [{ type: 'tool_use', input: 'hidden' }] } })),
    ] }) });
    await service.list();
    expect((await service.read(id)).messages).toEqual([{ role: 'user', text: 'הבקשה האחרונה' }]);
  });

  it('rejects oversized transcripts before reading', async () => {
    const getSessionMessages = vi.fn(async () => []);
    const service = new ClaudeSessionsService({ sdk: adapter({ listSessions: async () => [{ ...metadata, fileSize: 20 * 1024 * 1024 }], getSessionMessages }) });
    await service.list(); await expect(service.read(id)).rejects.toThrow('גדולה מדי');
    expect(getSessionMessages).not.toHaveBeenCalled();
  });
});

describe('Claude hook event collector', () => {
  it('writes only allowlisted fields atomically with private permissions and feeds live status', async () => {
    const directory = join(await temporary(), 'events');
    expect(await collectClaudeEvent({ session_id: id, cwd: metadata.cwd, hook_event_name: 'UserPromptSubmit', pid: 123,
      prompt: 'PRIVATE PROMPT', transcript_path: '/private/transcript', tool_input: { key: 'SECRET' } }, { directory, now: () => now })).toBe(true);
    const file = join(directory, `${id}.json`);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ sessionId: id, cwd: metadata.cwd, event: 'UserPromptSubmit', pid: 123, timestamp: now });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect(await readdir(directory)).toEqual([`${id}.json`]);
    const service = new ClaudeSessionsService({ sdk: adapter(), eventsDirectory: directory, now: () => now });
    expect((await service.list()).sessions[0].status).toBe('running');
    await writeFile(file, '{malformed');
    expect((await service.list()).sessions[0].status).toBe('unknown');
  });

  it('rejects traversal and malformed inputs, and refuses a symlink event directory', async () => {
    const directory = await temporary();
    for (const input of [null, {}, { session_id: '../../secret', cwd: metadata.cwd, hook_event_name: 'Stop' },
      { session_id: id, cwd: 'relative', hook_event_name: 'Stop' },
      { session_id: id, cwd: metadata.cwd, hook_event_name: 'UntrustedEvent' }]) {
      expect(await collectClaudeEvent(input, { directory })).toBe(false);
    }
    expect(await readdir(directory)).toEqual([]);
    const link = join(directory, 'link'); await symlink(await temporary(), link);
    expect(await collectClaudeEvent({ session_id: id, cwd: metadata.cwd, hook_event_name: 'Stop' }, { directory: link })).toBe(false);
  });
});

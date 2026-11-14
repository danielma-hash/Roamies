import { expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeRunService } from '../claude-run.service.js';
import { ClaudeRunJournal } from '../claude-run-journal.js';
const id = '12345678-1234-4567-8901-123456789abc';
async function harness(active: readonly string[] = [], journal?: ClaudeRunJournal) {
  const cwd = await mkdtemp('/tmp/roamies-run-test-');
  let emit: ((message: SDKMessage) => void) | undefined;
  let end: (() => void) | undefined;
  let options: Options | undefined;
  const received: string[] = [];
  const query = vi.fn((args: Parameters<NonNullable<ConstructorParameters<typeof ClaudeRunService>[0]['query']>>[0]) => {
    options = args.options;
    void (async () => { for await (const value of args.prompt) received.push(String(value.message.content)); })();
    const generator = (async function* () {
      while (true) {
        const message = await new Promise<SDKMessage | undefined>((resolve) => { emit = resolve; end = () => resolve(undefined); });
        if (!message) return;
        yield message;
      }
    })();
    return Object.assign(generator, { close: () => end?.() }) as Query;
  });
  let enabled = true;
  const confirm = vi.fn(async () => true);
  const service = new ClaudeRunService({ journal, executable: () => '/claude', allowActions: () => enabled, confirm, query, activeSessionIds: async () => active });
  const result = () => emit?.({ type: 'result', subtype: 'success', is_error: false, session_id: id } as SDKMessage);
  return { cwd, service, query, received, result, confirm, options: () => options!, disable: () => { enabled = false; } };
}
it('keeps follow-up instructions local until the current turn finishes; stop drops queued work', async () => {
  const h = await harness();
  await h.service.start(h.cwd, 'בדיקה', 'first', id);
  await h.service.send(id, 'second'); await h.service.send(id, 'third');
  await vi.waitFor(() => expect(h.received).toEqual(['first']));
  h.result(); await vi.waitFor(() => expect(h.received).toEqual(['first', 'second']));
  expect(h.service.stop(id)).toMatchObject({ state: 'stopped', queued: 0 });
  await expect(h.service.send(id, 'fourth')).rejects.toThrow();
  await Promise.resolve(); expect(h.received).toEqual(['first', 'second']);
});
it('restores a closed service and queued progress but only sends the explicitly approved new instruction', async () => {
  const file = join(await mkdtemp('/tmp/roamies-recovery-'), 'runs.json');
  const h = await harness([], new ClaudeRunJournal(file));
  await h.service.start(h.cwd, 'משימה נשמרת', 'first', id);
  await h.service.send(id, 'never automatically replay');
  h.service.close(); await h.service.flush();
  const restored = await harness([], new ClaudeRunJournal(file));
  await restored.service.initialize();
  expect(restored.query).not.toHaveBeenCalled();
  expect(restored.service.list()).toEqual([expect.objectContaining({ id, state: 'interrupted', queued: 1, recoveryInstructions: ['first', 'never automatically replay'] })]);
  await restored.service.start(h.cwd, 'משימה נשמרת', 'explicit next step', id);
  await vi.waitFor(() => expect(restored.received).toEqual(['explicit next step']));
  restored.service.stop(id); await restored.service.flush();
});
it('does not deliver a new instruction when its checkpoint cannot be saved', async () => {
  const journal = new ClaudeRunJournal('/unused');
  vi.spyOn(journal, 'load').mockResolvedValue([]);
  vi.spyOn(journal, 'save').mockRejectedValue(new Error('storage failed'));
  const h = await harness([], journal);
  await expect(h.service.start(h.cwd, 'בדיקה', 'must not run', id)).rejects.toThrow('storage failed');
  expect(h.received).toEqual([]);
  expect(h.service.list()[0]?.state).toBe('interrupted');
});
it('refuses external live sessions, unknown targets, disabled actions and duplicate writers', async () => {
  const h = await harness([id]);
  await expect(h.service.start(h.cwd, 'test', 'go', id)).rejects.toThrow('עדיין פתוח');
  expect(h.query).not.toHaveBeenCalled(); expect(() => h.service.stop(id)).toThrow();
  const own = await harness();
  await own.service.start(own.cwd, 'test', 'go', id);
  await expect(own.service.start(own.cwd, 'test', 'go', id)).rejects.toThrow('כבר');
  own.disable(); await expect(own.service.send(id, 'go')).rejects.toThrow();
  expect(own.service.stop(id).state).toBe('stopped');
});
it('routes every Claude tool through safety, denies keys and requires approval for commands', async () => {
  const h = await harness(); await h.service.start(h.cwd, 'test', 'go', id);
  const hook = h.options().hooks!.PreToolUse![0]!.hooks[0]!;
  const invoke = (tool_name: string, tool_input: unknown) => hook({ hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: 't', session_id: id, transcript_path: '', cwd: h.cwd }, undefined, { signal: new AbortController().signal });
  expect(await invoke('Read', { file_path: '/Users/someone/.ssh/id_rsa' })).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  expect(await invoke('Bash', { command: 'pwd' })).toMatchObject({ hookSpecificOutput: { permissionDecision: 'allow' } });
  expect(h.confirm).toHaveBeenCalledOnce();
  expect(await invoke('SendMessage', { recipient: 'x' })).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  h.disable(); expect(await invoke('Read', { file_path: join(h.cwd, 'a') })).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  h.service.close();
});
it('fails closed when live-session enumeration fails', async () => {
  const h = await harness();
  const service = new ClaudeRunService({ executable: () => '/claude', allowActions: () => true, confirm: async () => true, query: h.query, activeSessionIds: async () => { throw new Error('unavailable'); } });
  await expect(service.start(h.cwd, 'test', 'go', id)).rejects.toThrow(); expect(h.query).not.toHaveBeenCalled();
});

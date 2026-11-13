import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AttentionError, AttentionService } from '../attention.service.js';
import type { ClaudeSession, ClaudeSessionStatus } from '../claude-sessions.types.js';
import type { TaskCard } from '../task-cards.service.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roamies-attention-'));
  roots.push(root);
  const filePath = path.join(root, 'attention.json');
  return { root, filePath, service: new AttentionService({ filePath, now: () => 1000 }) };
}
const session = (status: ClaudeSessionStatus, id = 'session-1'): ClaudeSession => ({ id, status, title: 'משימה', cwd: '/repo', branch: 'main', updatedAt: 1 });
const card = (state?: string): TaskCard => ({ title: 'בדיקות', url: 'https://github.com/org/repo/pull/1', state: 'OPEN', headRefName: 'branch', headRefOid: 'abc', statusCheckRollup: state ? [{ state }] : null, observedAt: 1, deployment: 'unknown' });

describe('durable attention inbox', () => {
  it('establishes a silent baseline and emits only real waiting/ended transitions', async () => {
    const { service } = await setup();
    expect(await service.update([session('waiting')], [card('FAILURE')])).toEqual([]);
    expect(await service.update([session('waiting')], [card('FAILURE')])).toEqual([]);
    expect(await service.update([session('running')], [card('FAILURE')])).toEqual([]);
    expect((await service.update([session('waiting')], []))[0]?.kind).toBe('session-waiting');
    expect((await service.update([session('ended')], []))[0]?.kind).toBe('session-ended');
    expect((await service.snapshot()).unread).toBe(2);
  });

  it('keeps deduplication and dismissals across restart, but allows a later new transition', async () => {
    const { service, filePath } = await setup();
    await service.update([session('running')], []);
    const [first] = await service.update([session('waiting')], []);
    expect(first).toBeDefined();
    expect(await service.dismiss(first!.id)).toBe(true);
    const restarted = new AttentionService({ filePath, now: () => 2000 });
    expect(await restarted.update([session('waiting')], [])).toEqual([]);
    expect((await restarted.snapshot()).unread).toBe(0);
    expect(await restarted.dismiss(first!.id)).toBe(false);
    await restarted.update([session('running')], []);
    const [second] = await restarted.update([session('waiting')], []);
    expect(second?.id).not.toBe(first?.id);
    expect((await restarted.snapshot()).unread).toBe(1);
  });

  it('keeps quiet/focus preferences and unread items without proactive delivery or replay', async () => {
    const { service, filePath } = await setup();
    await service.update([session('running')], []);
    await service.setPreferences({ quiet: true });
    expect(await service.update([session('waiting')], [])).toEqual([]);
    const restarted = new AttentionService({ filePath });
    expect((await restarted.snapshot()).preferences.quiet).toBe(true);
    await restarted.setPreferences({ quiet: false, focus: true });
    expect(await restarted.update([session('ended')], [])).toEqual([]);
    expect((await restarted.snapshot()).unread).toBe(2);
    await restarted.setPreferences({ focus: false });
    expect(await restarted.update([session('ended')], [])).toEqual([]);
    expect((await restarted.snapshot()).preferences).toEqual({ quiet: false, focus: false });
  });

  it('announces check failure and success only after prior pending or failure', async () => {
    const { service } = await setup();
    await service.update([], [card()]);
    expect(await service.update([], [card('SUCCESS')])).toEqual([]);
    expect((await service.update([], [card('FAILURE')]))[0]?.kind).toBe('checks-failed');
    expect(await service.update([], [card('FAILURE')])).toEqual([]);
    expect((await service.update([], [card('SUCCESS')]))[0]?.kind).toBe('checks-passed');
    expect(await service.update([], [card('PENDING')])).toEqual([]);
    expect((await service.update([], [card('SUCCESS')]))[0]?.kind).toBe('checks-passed');
  });

  it('requires every check to finish successfully and does not infer success from absent checks', async () => {
    const { service } = await setup();
    await service.update([], [card('PENDING')]);
    expect(await service.update([], [card()])).toEqual([]);
    expect(await service.update([], [{ ...card(), statusCheckRollup: [{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }] }])).toEqual([]);
    expect((await service.update([], [{ ...card(), statusCheckRollup: [{ conclusion: 'SUCCESS' }, { state: 'ERROR' }] }]))[0]?.kind).toBe('checks-failed');
    expect((await service.update([], [{ ...card(), statusCheckRollup: [{ conclusion: 'SUCCESS' }, { conclusion: 'SKIPPED' }] }]))[0]?.kind).toBe('checks-passed');
  });

  it('does not interpret disappearance or unknown status as completion', async () => {
    const { service } = await setup();
    await service.update([session('running')], []);
    expect(await service.update([], [])).toEqual([]);
    expect(await service.update([session('unknown')], [])).toEqual([]);
    expect(await service.update([session('running')], [])).toEqual([]);
    expect(await service.update([session('waiting', 'new-history-entry')], [])).toEqual([]);
    expect((await service.snapshot()).unread).toBe(0);
  });

  it('serializes simultaneous polls and persists a private file without leftover temporary files', async () => {
    const { service, root, filePath } = await setup();
    await service.update([session('running')], []);
    const delivered = await Promise.all([service.update([session('waiting')], []), service.update([session('waiting')], [])]);
    expect(delivered.flat()).toHaveLength(1);
    expect(await fs.readdir(root)).toEqual(['attention.json']);
    if (process.platform !== 'win32') expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it('caps the inbox at one hundred and returns detached snapshots', async () => {
    const { service } = await setup();
    await service.update([session('running')], []);
    for (let i = 0; i < 105; i++) {
      await service.update([session('running')], []);
      await service.update([session('waiting')], []);
    }
    const snapshot = await service.snapshot();
    expect(snapshot.events).toHaveLength(100);
    expect(snapshot.unread).toBe(100);
    Object.assign(snapshot.preferences, { quiet: true });
    expect((await service.snapshot()).preferences.quiet).toBe(false);
  });

  it('reports corrupt or newer saved data honestly without overwriting it', async () => {
    const { filePath } = await setup();
    for (const content of ['{broken', '{"version":2}']) {
      await fs.writeFile(filePath, content);
      const service = new AttentionService({ filePath });
      await expect(service.update([session('running')], [])).rejects.toBeInstanceOf(AttentionError);
      expect(await fs.readFile(filePath, 'utf8')).toBe(content);
    }
  });

  it('does not acknowledge a failed save or lose the transition on retry', async () => {
    const { service, filePath } = await setup();
    await service.update([session('running')], []);
    await fs.unlink(filePath);
    await fs.mkdir(filePath);
    await expect(service.update([session('waiting')], [])).rejects.toBeInstanceOf(AttentionError);
    expect((await service.snapshot()).unread).toBe(0);
    await fs.rmdir(filePath);
    expect(await service.update([session('waiting')], [])).toHaveLength(1);
    expect((await service.snapshot()).unread).toBe(1);
  });
});

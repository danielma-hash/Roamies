import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TaskRunService } from '../task-run.service.js';
import { TaskRunStoreService } from '../task-run-store.service.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp('/tmp/roamies-task-'); roots.push(root);
  const file = join(root, 'tasks.json'); const store = new TaskRunStoreService(file); const service = new TaskRunService(store);
  await service.initialize(); return { root, file, store, service };
}
it('restores running and queued requests as interrupted, retains unknown effects, and never replays', async () => {
  const { file, service } = await fixture();
  const task = await service.create('בדיקה api_key=private-value'); await service.start(task.id, 'conversation');
  await service.beginTool(task.id, 'a', 'write_file', { text: 'not stored raw' });
  const queued = await service.create('תור שמור', true);
  const recovered = new TaskRunService(new TaskRunStoreService(file)); await recovered.initialize();
  expect(recovered.get(task.id)).toMatchObject({ status: 'interrupted', verified: false, conversationId: 'conversation', tools: [{ id: 'a', status: 'unknown' }] });
  expect(recovered.get(queued.id)).toMatchObject({ status: 'interrupted', hasImage: true });
  await expect(recovered.start(task.id)).rejects.toThrow('אוטומטית');
  const body = await readFile(file, 'utf8'); expect(body).not.toContain('private-value'); expect(body).not.toContain('not stored raw');
  expect((await stat(file)).mode & 0o777).toBe(0o600);
});
it('checkpoints before execution and records returned without asserting task verification', async () => {
  const { service, file } = await fixture(); const task = await service.create('בדיקה'); await service.start(task.id);
  const perform = vi.fn(async () => {
    const disk = JSON.parse(await readFile(file, 'utf8'));
    expect(disk.runs[0].tools[0].status).toBe('pending'); return 'actual result';
  });
  const wrapped = service.wrap([{ name: 'fixture', description: 'test', parameters: z.object({}), execute: perform }], () => task.id, vi.fn())[0]!;
  const context = { signal: new AbortController().signal, toolCallId: 'call' };
  expect(await wrapped.execute({}, context)).toBe('actual result');
  await service.finish(task.id, 'returned');
  expect(service.get(task.id)).toMatchObject({ status: 'returned', verified: false, tools: [{ status: 'returned' }] });
  await expect(wrapped.execute({}, context)).rejects.toThrow(); expect(perform).toHaveBeenCalledOnce();
});
it('stops before a side effect if the preflight checkpoint cannot be persisted', async () => {
  const { service, store } = await fixture(); const task = await service.create('בדיקה'); await service.start(task.id);
  vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('disk full'));
  const perform = vi.fn(async () => 'result'); const abort = vi.fn();
  const wrapped = service.wrap([{ name: 'fixture', description: 'test', parameters: z.object({}), execute: perform }], () => task.id, abort)[0]!;
  await expect(wrapped.execute({}, { signal: new AbortController().signal, toolCallId: 'call' })).rejects.toThrow('לשמור');
  expect(perform).not.toHaveBeenCalled(); expect(abort).toHaveBeenCalledOnce();
  await expect(service.create('later')).rejects.toThrow();
});
it('keeps a possibly applied action uncertain if its result checkpoint fails', async () => {
  const { service, store, file } = await fixture(); const task = await service.create('בדיקה'); await service.start(task.id);
  const perform = vi.fn(async () => { vi.spyOn(store, 'save').mockRejectedValue(new Error('disk full')); return 'applied'; });
  const wrapped = service.wrap([{ name: 'fixture', description: 'test', parameters: z.object({}), execute: perform }], () => task.id, vi.fn())[0]!;
  await expect(wrapped.execute({}, { signal: new AbortController().signal, toolCallId: 'call' })).rejects.toThrow();
  expect(perform).toHaveBeenCalledOnce();
  const recovered = new TaskRunService(new TaskRunStoreService(file)); await recovered.initialize();
  expect(recovered.get(task.id).tools[0]?.status).toBe('unknown');
});
it('serializes concurrent checkpoints, prevents duplicate calls and ignores late success after stop', async () => {
  const { service } = await fixture(); const task = await service.create('בדיקה'); await service.start(task.id);
  await Promise.all([service.beginTool(task.id, 'a', 'one', {}), service.beginTool(task.id, 'b', 'two', {})]);
  await expect(service.beginTool(task.id, 'a', 'one', {})).rejects.toThrow('כבר');
  await service.finish(task.id, 'interrupted'); await service.endTool(task.id, 'a', 'late success');
  expect(service.get(task.id).tools.map((tool) => tool.status)).toEqual(['unknown', 'unknown']);
});
it('fails closed on corrupt/symlinked archives without replacing them', async () => {
  const { file, root } = await fixture(); await writeFile(file, 'not json');
  await expect(new TaskRunService(new TaskRunStoreService(file)).initialize()).rejects.toThrow();
  expect(await readFile(file, 'utf8')).toBe('not json');
  const linked = join(root, 'linked'); await symlink(file, linked);
  await expect(new TaskRunStoreService(linked).load()).rejects.toThrow();
});
it('does not discard unresolved effects when retention fills up', async () => {
  const { file } = await fixture();
  const runs = Array.from({ length: 100 }, () => ({ id: randomUUID(), request: 'unresolved', hasImage: false, status: 'interrupted', verified: false, createdAt: 1, updatedAt: 1, tools: [] }));
  const original = JSON.stringify({ version: 1, runs }); await writeFile(file, original);
  const full = new TaskRunService(new TaskRunStoreService(file)); await full.initialize();
  await expect(full.create('new')).rejects.toThrow('מלא'); expect(await readFile(file, 'utf8')).toBe(original);
  runs[19]!.status = 'returned'; await writeFile(file, JSON.stringify({ version: 1, runs }));
  const reusable = new TaskRunService(new TaskRunStoreService(file)); await reusable.initialize(); await reusable.create('new');
  expect(reusable.list()).toHaveLength(100); expect(reusable.list().some((run) => run.id === runs[19]!.id)).toBe(false);
  expect(reusable.list().filter((run) => run.status === 'interrupted')).toHaveLength(99);
});

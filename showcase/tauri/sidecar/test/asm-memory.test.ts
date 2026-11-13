import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AsmMemoryService } from '../asm-memory.service.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function fixture(memories: readonly object[] = [], nodes: readonly object[] = [], lifecycle: readonly object[] = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roamies-asm-'));
  roots.push(root);
  await Promise.all([
    fs.writeFile(path.join(root, 'brain.json'), JSON.stringify({ nodes })),
    fs.writeFile(path.join(root, 'memory.jsonl'), memories.map((row) => JSON.stringify(row)).join('\n')),
    fs.writeFile(path.join(root, 'lifecycle.jsonl'), lifecycle.map((row) => JSON.stringify(row)).join('\n')),
  ]);
  return root;
}
const memory = (id: string, summary = 'PacoBot זיכרון בדיקה', extra: Record<string, unknown> = {}) => ({ id, summary, details: 'מידע מקומי', files: ['Projects/PacoBot'], created_at: '2026-11-13T10:00:00Z', ...extra });
const operation = (id: string, op: string, target: string, kind = 'record', extra: Record<string, unknown> = {}) => ({ id: `lc_${id}`, op, target: { kind, id: target }, reason: 'verified', ...extra });

describe('local read-only ASM recall', () => {
  it('finds Hebrew with niqqud and returns bounded citations from metadata only', async () => {
    const root = await fixture([memory('m1', 'PacoBot תִּזְכּוֹרֶת חדשה')], [
      { id: 'vault:v1', layer: 'vault', kind: 'page', label: 'Ordico תזכורת', path: '/must/not/read.md', meta: { description: 'תיאור '.repeat(50), updatedAt: '2026-11-12' } },
      { id: 'agents:x', layer: 'agents', kind: 'file', label: 'PacoBot תזכורת' },
    ]);
    const service = new AsmMemoryService({ root, maxExcerptChars: 40 });
    const result = await service.search('תזכורת', { scope: 'company' });
    expect(result.map((row) => row.id)).toEqual(['memory:m1', 'vault:v1']);
    expect(result.every((row) => row.excerpt.length <= 40)).toBe(true);
    expect(result[1]?.path).toBe('/must/not/read.md');
    expect(result[0]).toMatchObject({ source: 'memory', status: 'active', date: '2026-11-13T10:00:00Z' });
  });

  it('excludes unknown and mixed records, including a personal project under the company workspace', async () => {
    const root = await fixture([
      memory('company'),
      memory('personal', 'Gather זיכרון', { files: ['/Users/me/Desktop/iPracticom/Projects/Gather'] }),
      memory('mixed', 'PacoBot and Anna זיכרון'),
      memory('unknown', 'זיכרון ללא סיווג', { files: [] }),
      memory('mislabelled', 'Anna זיכרון', { files: [], scope: 'company' }),
    ]);
    const service = new AsmMemoryService({ root });
    expect((await service.search('זיכרון', { scope: 'company' })).map((row) => row.id)).toEqual(['memory:company']);
    expect((await service.search('זיכרון', { scope: 'personal' })).map((row) => row.id)).toEqual(['memory:personal']);
    expect(await service.search('זיכרון', { scope: 'company', project: 'Gather' })).toEqual([]);
  });

  it('honors exact project filters and injected project scopes without overriding personal boundaries', async () => {
    const root = await fixture([memory('p'), memory('o', 'Ordico זיכרון', { files: [] }), memory('new', 'NewTool זיכרון', { files: [] }), memory('g', 'Gather זיכרון', { files: [] })]);
    const service = new AsmMemoryService({ root, projectScopes: { newtool: 'company', gather: 'company' } });
    expect((await service.search('זיכרון', { scope: 'company', project: 'PACOBOT' })).map((row) => row.id)).toEqual(['memory:p']);
    expect((await service.search('זיכרון', { scope: 'company', project: 'newtool' })).map((row) => row.id)).toEqual(['memory:new']);
    expect(await service.search('זיכרון', { scope: 'company', project: 'gather' })).toEqual([]);
    expect(await service.search('זיכרון', { scope: 'company', project: 'not-catalogued' })).toEqual([]);
  });

  it('hides superseded and retired records, retains done pages with status, and excludes closed threads from excerpts', async () => {
    const root = await fixture([
      memory('old'), memory('current', undefined, { supersedes: ['memory:old'], open_threads: ['never expose this closed thread'] }), memory('retired'), memory('closed'),
    ], [{ id: 'vault:done', layer: 'vault', kind: 'page', label: 'PacoBot זיכרון' }], [
      operation('retire', 'retire', 'retired'), operation('close', 'close_thread', 'closed'),
      operation('thread', 'close_thread', 'current#0', 'thread'), operation('done', 'mark_done', 'vault:done', 'page'),
    ]);
    const result = await new AsmMemoryService({ root }).search('זיכרון', { scope: 'company' });
    expect(result.map((row) => row.id)).toEqual(['memory:current', 'vault:done']);
    expect(result[1]?.status).toBe('done');
    expect(JSON.stringify(result)).not.toContain('closed thread');
  });

  it('restores only the current operation and does not undo a later retirement', async () => {
    const root = await fixture([memory('restored'), memory('still-hidden')], [], [
      operation('a', 'retire', 'restored'), operation('b', 'restore', 'restored', 'record', { undoes: 'lc_a' }),
      operation('c', 'retire', 'still-hidden'), operation('d', 'retire', 'still-hidden'),
      operation('e', 'restore', 'still-hidden', 'record', { undoes: 'lc_c' }),
      operation('a', 'retire', 'restored'),
    ]);
    expect((await new AsmMemoryService({ root }).search('זיכרון', { scope: 'company' })).map((row) => row.id)).toEqual(['memory:restored']);
  });

  it('restoring ledger retirement preserves earlier supersedes retirement', async () => {
    const root = await fixture([memory('old'), memory('new', undefined, { supersedes: ['old'] })], [], [
      operation('a', 'retire', 'old'), operation('b', 'restore', 'old', 'record', { undoes: 'lc_a' }),
    ]);
    expect((await new AsmMemoryService({ root }).search('זיכרון', { scope: 'company' })).map((row) => row.id)).toEqual(['memory:new']);
  });

  it('redacts credential formats in every returned text field', async () => {
    const root = await fixture([memory('m', 'PacoBot api_key=supersecret', {
      details: 'password="private value" Authorization: Bearer arbitrary-token sk-proj-abcdefghijklmnop ghp_abcdefghijklmnop https://user:pass@example.com',
      files: ['/PacoBot/password=path-secret'],
    })]);
    const result = JSON.stringify(await new AsmMemoryService({ root }).search('PacoBot', { scope: 'company' }));
    for (const secret of ['supersecret', 'private value', 'arbitrary-token', 'sk-proj-abcdefghijklmnop', 'ghp_abcdefghijklmnop', 'user:pass', 'path-secret']) expect(result).not.toContain(secret);
    expect(result).toContain('[redacted]');
  });

  it('limits ranked results, excludes zero matches, and leaves inputs byte-identical', async () => {
    const root = await fixture(Array.from({ length: 12 }, (_, i) => memory(`m${i}`)));
    const names = ['brain.json', 'memory.jsonl', 'lifecycle.jsonl'];
    const before = await Promise.all(names.map((name) => fs.readFile(path.join(root, name), 'utf8')));
    const service = new AsmMemoryService({ root, maxResults: 3 });
    expect(await service.search('זיכרון', { scope: 'company' })).toHaveLength(3);
    expect(await service.search('unmatched', { scope: 'company' })).toEqual([]);
    expect(await service.search('?!', { scope: 'company' })).toEqual([]);
    expect(await Promise.all(names.map((name) => fs.readFile(path.join(root, name), 'utf8')))).toEqual(before);
    expect((await fs.readdir(root)).sort()).toEqual(names.sort());
  });

  it('skips malformed JSONL lines and malformed ledger operations', async () => {
    const root = await fixture([memory('good')], [], [operation('bad', 'retire', 'good', 'record', { ts: 42 })]);
    await fs.appendFile(path.join(root, 'memory.jsonl'), '\n{broken\nnull\n[]\n');
    expect(await new AsmMemoryService({ root }).search('זיכרון', { scope: 'company' })).toHaveLength(1);
  });

  it('fails closed for an oversized or symlinked ledger and tolerates absent ASM', async () => {
    const root = await fixture([memory('m')]);
    expect(await new AsmMemoryService({ root, maxFileBytes: 10 }).search('זיכרון', { scope: 'company' })).toEqual([]);
    await fs.unlink(path.join(root, 'lifecycle.jsonl'));
    await fs.symlink(path.join(root, 'memory.jsonl'), path.join(root, 'lifecycle.jsonl'));
    expect(await new AsmMemoryService({ root }).search('זיכרון', { scope: 'company' })).toEqual([]);
    expect(await new AsmMemoryService({ root: path.join(root, 'missing') }).search('זיכרון', { scope: 'company' })).toEqual([]);
  });
});

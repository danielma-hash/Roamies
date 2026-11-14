import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AsmIndexService } from '../asm-index.service.js';
import { AsmMemoryService } from '../asm-memory.service.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roamies-asm-cache-')); roots.push(root);
  await fs.writeFile(path.join(root,'brain.json'), '{"nodes":[]}');
  await fs.writeFile(path.join(root,'memory.jsonl'), JSON.stringify({ id: 'one', summary: 'PacoBot זיכרון' }));
  await fs.writeFile(path.join(root,'lifecycle.jsonl'), '');
  return root;
}
it('reuses the parsed snapshot and coalesces simultaneous refreshes', async () => {
  const index = new AsmIndexService(await fixture(), 1024 * 1024);
  const [one,two] = await Promise.all([index.snapshot(),index.snapshot()]);
  expect(one).toBe(two); expect(one.revision).toBe(1); expect(await index.snapshot()).toBe(one);
});
it('refreshes lifecycle immediately and never serves a retired record from cache', async () => {
  const root = await fixture(); const memory = new AsmMemoryService({ root });
  expect(await memory.search('זיכרון',{scope:'company'})).toHaveLength(1);
  await fs.writeFile(path.join(root,'lifecycle.jsonl'), JSON.stringify({id:'lc_retire',op:'retire',target:{kind:'record',id:'one'},reason:'test'}));
  expect(await memory.search('זיכרון',{scope:'company'})).toEqual([]);
  await fs.appendFile(path.join(root,'lifecycle.jsonl'), '\n'+JSON.stringify({id:'lc_restore',op:'restore',target:{kind:'record',id:'one'},undoes:'lc_retire',reason:'test'}));
  expect(await memory.search('זיכרון',{scope:'company'})).toHaveLength(1);
});
it('detects atomic replacement with equal size and preserved modification time', async () => {
  const root = await fixture(); const index = new AsmIndexService(root,1024 * 1024); const old = await index.snapshot();
  const file = path.join(root,'memory.jsonl'); const stat = await fs.stat(file); const replacement = (await fs.readFile(file,'utf8')).replace('one','two');
  await fs.writeFile(file+'.next',replacement); await fs.utimes(file+'.next',stat.atime,stat.mtime); await fs.rename(file+'.next',file);
  const next = await index.snapshot(); expect(next.revision).toBe(2); expect(next).not.toBe(old); expect(next.memories[0].id).toBe('two');
});
it('refuses a symlink introduced after a successful search', async () => {
  const root = await fixture(); const memory = new AsmMemoryService({root}); await memory.search('זיכרון',{scope:'company'});
  await fs.unlink(path.join(root,'lifecycle.jsonl')); await fs.symlink(path.join(root,'memory.jsonl'),path.join(root,'lifecycle.jsonl'));
  await expect(memory.search('זיכרון',{scope:'company'})).rejects.toThrow('לא ניתן לרענן');
});
it('reports invalid refresh rather than serving stale data and recovers after repair', async () => {
  const root = await fixture(); const index = new AsmIndexService(root,1024 * 1024); await index.snapshot();
  await fs.writeFile(path.join(root,'brain.json'),'{broken'); await expect(index.snapshot()).rejects.toThrow('לא ניתן לרענן');
  await fs.writeFile(path.join(root,'brain.json'),'{"nodes":[]}'); expect((await index.snapshot()).revision).toBe(2);
});
it('does not reinterpret a missing ledger or vanished sources as an empty valid index', async () => {
  const root = await fixture(); const index = new AsmIndexService(root,1024 * 1024); await index.snapshot();
  await fs.unlink(path.join(root,'lifecycle.jsonl')); await expect(index.snapshot()).rejects.toThrow('חסר מקור');
  await fs.unlink(path.join(root,'brain.json')); await fs.unlink(path.join(root,'memory.jsonl')); await expect(index.snapshot()).rejects.toThrow('חסר מקור');
});

it('refuses a corrupt lifecycle refresh rather than resurrecting retired memories', async () => {
  const root = await fixture(); const memory = new AsmMemoryService({ root });
  await fs.writeFile(path.join(root,'lifecycle.jsonl'), JSON.stringify({id:'lc_retire',op:'retire',target:{kind:'record',id:'one'},reason:'test'}));
  expect(await memory.search('זיכרון',{scope:'company'})).toEqual([]);
  await fs.writeFile(path.join(root,'lifecycle.jsonl'), '{broken');
  await expect(memory.search('זיכרון',{scope:'company'})).rejects.toThrow('יומן מחזור החיים');
});

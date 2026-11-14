import { expect, it, vi } from 'vitest';
import { TaskCardsService } from '../task-cards.service.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
it('validates targets before invoking gh and never equates merge or checks with deployment', async () => {
  const read = vi.fn(async () => JSON.stringify({ title:'תיקון',url:'https://github.com/team/project/pull/1',state:'MERGED',headRefName:'fix',headRefOid:'abc',statusCheckRollup:[{conclusion:'SUCCESS'}] }));
  const service = new TaskCardsService(read);
  await expect(service.read('https://evil.invalid/a')).rejects.toThrow(); expect(read).not.toHaveBeenCalled();
  const card = await service.read('https://github.com/team/project/pull/1'); expect(card.deployment).toBe('unknown'); expect(card.state).toBe('MERGED'); expect(read).toHaveBeenCalledWith('team/project','1',undefined);
});

it('persists both cards when polling and a user action track concurrently', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'roamies-task-race-'));
  const file = path.join(root, 'cards.json');
  try {
    const service = new TaskCardsService(async (repo, number) => JSON.stringify({ title:`PR ${number}`,url:`https://github.com/${repo}/pull/${number}`,state:'OPEN',headRefName:'fix',headRefOid:'abc',statusCheckRollup:[] }), file);
    await Promise.all([service.track('https://github.com/team/project/pull/1'), service.track('https://github.com/team/project/pull/2')]);
    expect(service.list().map(card => card.url).sort()).toEqual(['https://github.com/team/project/pull/1', 'https://github.com/team/project/pull/2']);
    const saved = new TaskCardsService(undefined, file); await saved.load();
    expect(saved.list().map(card => card.url).sort()).toEqual(service.list().map(card => card.url).sort());
    expect(JSON.parse(await readFile(file, 'utf8'))).toHaveLength(2);
  } finally { await rm(root, { recursive:true, force:true }); }
});

it('lets later queued updates proceed after one GitHub request fails', async () => {
  const service = new TaskCardsService(async (repo, number) => {
    if (number === '1') throw new Error('fixture read failure');
    return JSON.stringify({ title:'Second',url:`https://github.com/${repo}/pull/${number}`,state:'OPEN',headRefName:'fix',headRefOid:'abc',statusCheckRollup:[] });
  });
  const result = await Promise.allSettled([service.track('https://github.com/team/project/pull/1'), service.track('https://github.com/team/project/pull/2')]);
  expect(result.map(item => item.status)).toEqual(['rejected','fulfilled']);
  expect(service.list().map(card => card.url)).toEqual(['https://github.com/team/project/pull/2']);
});

it('passes cancellation to the GitHub read process',async()=>{
 const signal=new AbortController().signal;const read=vi.fn(async()=>JSON.stringify({title:'fixture',url:'https://github.com/team/project/pull/1',state:'OPEN',headRefName:'fix',headRefOid:'abc',statusCheckRollup:[]}));
 await new TaskCardsService(read).read('https://github.com/team/project/pull/1',undefined,signal);expect(read).toHaveBeenCalledWith('team/project','1',signal);
});

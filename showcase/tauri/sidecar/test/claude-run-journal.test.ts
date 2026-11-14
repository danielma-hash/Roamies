import { expect, it } from 'vitest';
import { mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ClaudeRunJournal } from '../claude-run-journal.js';
import type { ClaudeRunSnapshot } from '../claude-run.types.js';

const run: ClaudeRunSnapshot = { id: '12345678-1234-4567-8901-123456789abc', title: 'המשימה שלי', cwd: '/tmp/test',
  state: 'running', queued: 1, lastReply: 'הבדיקה הראשונה עברה', recoveryInstructions: ['בדוק קובץ', 'הכן סיכום'], updatedAt: 100 };
it('recovers private progress without claiming a live process or replaying instructions', async () => {
  const file = join(await mkdtemp('/tmp/roamies-journal-'), 'runs.json');
  const journal = new ClaudeRunJournal(file);
  expect(await journal.load()).toEqual([]);
  await journal.save([run]);
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(await new ClaudeRunJournal(file).load()).toEqual([expect.objectContaining({ ...run, state: 'interrupted' })]);
  await Promise.all([journal.save([{ ...run, state: 'idle' }]), journal.save([{ ...run, state: 'stopped', queued: 0, recoveryInstructions: [] }])]);
  expect(await journal.load()).toEqual([expect.objectContaining({ state: 'stopped', queued: 0, recoveryInstructions: [] })]);
});
it('refuses corrupt, duplicate and symlinked journals without resetting evidence', async () => {
  const dir = await mkdtemp('/tmp/roamies-journal-invalid-');
  const file = join(dir, 'runs.json');
  await writeFile(file, 'broken');
  await expect(new ClaudeRunJournal(file).load()).rejects.toThrow('ללא איפוס');
  expect(await readFile(file, 'utf8')).toBe('broken');
  await writeFile(file, JSON.stringify({ version: 1, runs: [run, run] }));
  await expect(new ClaudeRunJournal(file).load()).rejects.toThrow();
  const link = join(dir, 'link.json'); await symlink(file, link);
  await expect(new ClaudeRunJournal(link).load()).rejects.toThrow();
});
it('does not acknowledge later writes after a storage failure', async () => {
  const dir = await mkdtemp('/tmp/roamies-journal-write-');
  const parent = join(dir, 'file'); await writeFile(parent, 'not a directory');
  const journal = new ClaudeRunJournal(join(parent, 'runs.json'));
  await expect(journal.save([run])).rejects.toThrow();
  await expect(journal.save([])).rejects.toThrow();
});

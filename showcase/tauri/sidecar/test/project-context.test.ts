import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectContextService } from '../project-context.service.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture(): Promise<{ base: string; root: string; cwd: string }> {
  const base = await mkdtemp('/tmp/roamies-project-context-'); roots.push(base);
  const root = join(base, 'repo'); const cwd = join(root, 'src');
  await mkdir(cwd, { recursive: true }); await mkdir(join(root, '.git'));
  return { base, root, cwd };
}
it('loads scoped instructions root-first with hashes, without parent guidance or settings/import expansion', async () => {
  const { base, root, cwd } = await fixture();
  await writeFile(join(base, 'AGENTS.md'), 'OUTSIDE_GUIDANCE');
  await writeFile(join(root, 'AGENTS.md'), 'ענה בעברית');
  await writeFile(join(root, 'CLAUDE.md'), '@hidden.md');
  await writeFile(join(root, 'hidden.md'), 'IMPORTED_SECRET');
  await mkdir(join(root, '.claude'));
  await writeFile(join(root, '.claude/settings.json'), '{"hooks":{"command":"DO_NOT_RUN"}}');
  await writeFile(join(root, '.claude/CLAUDE.md'), 'כללים נוספים');
  await writeFile(join(cwd, 'AGENTS.md'), 'Scoped child rules');
  const context = await new ProjectContextService().load(cwd);
  expect(context.receipt.sources.map((s) => s.path)).toEqual(['AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md', 'src/AGENTS.md']);
  expect(context.receipt.sources.every((s) => /^[a-f0-9]{64}$/.test(s.sha256))).toBe(true);
  expect(context.prompt).toContain('ענה בעברית');
  for (const forbidden of ['OUTSIDE_GUIDANCE', 'IMPORTED_SECRET', 'DO_NOT_RUN']) expect(context.prompt).not.toContain(forbidden);
  const unchanged = await new ProjectContextService().load(cwd);
  expect(unchanged.receipt.digest).toBe(context.receipt.digest);
  await writeFile(join(cwd, 'AGENTS.md'), 'changed');
  expect((await new ProjectContextService().load(cwd)).receipt.digest).not.toBe(context.receipt.digest);
});
it('uses the nearest worktree marker and a non-Git directory never inherits an arbitrary ancestor', async () => {
  const { root, cwd } = await fixture();
  await writeFile(join(root, 'AGENTS.md'), 'PARENT');
  await writeFile(join(cwd, '.git'), 'gitdir: /unrelated/path');
  await writeFile(join(cwd, 'AGENTS.md'), 'CHILD');
  expect((await new ProjectContextService().load(cwd)).receipt.sources.map((s) => s.path)).toEqual(['AGENTS.md']);
  await rm(join(cwd, '.git')); await rm(join(root, '.git'), { recursive: true });
  expect((await new ProjectContextService().load(cwd)).prompt).not.toContain('PARENT');
});
it('refuses symlinked files and escaping instruction directories rather than silently dropping rules', async () => {
  const { base, root, cwd } = await fixture();
  const outside = join(base, 'outside'); await mkdir(outside);
  await writeFile(join(outside, 'CLAUDE.md'), 'PRIVATE');
  await symlink(join(outside, 'CLAUDE.md'), join(root, 'AGENTS.md'));
  await expect(new ProjectContextService().load(cwd)).rejects.toThrow('טעינת הוראות');
  await rm(join(root, 'AGENTS.md')); await symlink(outside, join(root, '.claude'));
  await expect(new ProjectContextService().load(cwd)).rejects.toThrow('גבולות');
});
it('fails closed on malformed, non-regular, oversized or excessive instruction input', async () => {
  const { root } = await fixture(); const source = join(root, 'AGENTS.md'); const service = new ProjectContextService();
  await writeFile(source, Buffer.from([0xff])); await expect(service.load(root)).rejects.toThrow('UTF-8');
  await writeFile(source, 'abc\0'); await expect(service.load(root)).rejects.toThrow('בינארי');
  await rm(source); await mkdir(source); await expect(service.load(root)).rejects.toThrow('קובץ רגיל');
  await rm(source, { recursive: true });
  await writeFile(source, 'x'.repeat(32 * 1024 + 1)); await expect(service.load(root)).rejects.toThrow('32 KiB');
  await writeFile(source, 'x'.repeat(32 * 1024));
  await writeFile(join(root, 'CLAUDE.md'), 'x'.repeat(32 * 1024));
  await mkdir(join(root, '.claude')); await writeFile(join(root, '.claude/CLAUDE.md'), 'x');
  await expect(service.load(root)).rejects.toThrow('64 KiB');
});

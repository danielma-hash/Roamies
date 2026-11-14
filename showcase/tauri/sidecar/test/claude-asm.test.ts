import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AsmMemoryService } from '../asm-memory.service.js';
import { createClaudeAsmTool } from '../claude-asm-tool.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture(): Promise<AsmMemoryService> {
  const root = await mkdtemp('/tmp/roamies-claude-asm-'); roots.push(root);
  await writeFile(join(root, 'brain.json'), '{"nodes":[]}');
  await writeFile(join(root, 'memory.jsonl'), [
    { id: 'company', summary: 'PacoBot fixture', details: 'COMPANY_ONLY', files: ['Projects/PacoBot'] },
    { id: 'personal', summary: 'Gather fixture', details: 'PERSONAL_ONLY', files: ['Projects/Gather'] },
    { id: 'assistant', summary: 'Roamies fixture', details: 'ASSISTANT_ONLY', files: ['Projects/Roamies'] },
    { id: 'mixed', summary: 'PacoBot Gather fixture', details: 'MIXED_HIDDEN' },
    { id: 'retired', summary: 'PacoBot fixture', details: 'RETIRED_HIDDEN' },
  ].map((row) => JSON.stringify(row)).join('\n'));
  await writeFile(join(root, 'lifecycle.jsonl'), JSON.stringify({ id: 'lc_retired', op: 'retire', target: { kind: 'record', id: 'retired' }, reason: 'fixture' }));
  return new AsmMemoryService({ root });
}
it('fixes the project and personal/company scope before the model calls recall', async () => {
  const memory = await fixture();
  const company = createClaudeAsmTool(memory, '/workspace/PacoBot', () => true)!;
  expect(company.context).toEqual({ project: 'pacobot', scope: 'company' });
  expect(Object.keys(company.definition.inputSchema)).toEqual(['query']);
  const companyResult = JSON.stringify(await company.definition.handler({ query: 'fixture' }, {}));
  expect(companyResult).toContain('COMPANY_ONLY');
  for (const hidden of ['PERSONAL_ONLY', 'ASSISTANT_ONLY', 'MIXED_HIDDEN', 'RETIRED_HIDDEN']) expect(companyResult).not.toContain(hidden);
  const personal = createClaudeAsmTool(memory, '/workspace/Gather', () => true)!;
  const personalResult = JSON.stringify(await personal.definition.handler({ query: 'fixture' }, {}));
  expect(personalResult).toContain('PERSONAL_ONLY'); expect(personalResult).not.toContain('COMPANY_ONLY');
  const jarvis = createClaudeAsmTool(memory, '/workspace/Roamies', () => true)!;
  expect(JSON.stringify(await jarvis.definition.handler({ query: 'fixture' }, {}))).toContain('ASSISTANT_ONLY');
  expect(createClaudeAsmTool(memory, '/workspace/Unknown', () => true)).toBeUndefined();
});
it('rejects extra scope/path arguments and invalid query lengths', async () => {
  const bridge = createClaudeAsmTool(await fixture(), '/workspace/PacoBot', () => true)!;
  const forged = { query: 'fixture', scope: 'personal', project: 'gather', path: '/private' };
  await expect(bridge.definition.handler(forged, {})).rejects.toThrow();
  await expect(bridge.definition.handler({ query: 'x'.repeat(201) }, {})).rejects.toThrow();
});
it('does not read when revoked, and discards a result revoked during an outstanding read', async () => {
  const memory = await fixture(); let allowed = false;
  const read = vi.spyOn(memory, 'search');
  const bridge = createClaudeAsmTool(memory, '/workspace/PacoBot', () => allowed)!;
  expect(await bridge.definition.handler({ query: 'fixture' }, {})).toMatchObject({ isError: true });
  expect(read).not.toHaveBeenCalled();
  allowed = true;
  read.mockImplementationOnce(async () => { allowed = false; return [{ source: 'memory', id: 'x', title: 'WITHHELD', excerpt: '', path: '', status: 'active' }]; });
  const result = await bridge.definition.handler({ query: 'fixture' }, {});
  expect(result).toMatchObject({ isError: true }); expect(JSON.stringify(result)).not.toContain('WITHHELD');
});

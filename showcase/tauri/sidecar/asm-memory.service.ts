import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AsmLifecycleState, AsmMemoryCitation, AsmMemoryOptions, AsmMemoryScope, AsmMemorySearchOptions } from './asm-memory.types.js';

const DEFAULT_PROJECTS: Readonly<Record<string, AsmMemoryScope>> = {
  pacobot: 'company', vocaly: 'company', ordico: 'company', knx: 'company',
  'software-factory': 'company', 'ai-spend-tower': 'company',
  gather: 'personal', anna: 'personal', ultron: 'personal', 'ipracticom-deck': 'personal',
};
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const normalized = (value: string): string => value.normalize('NFC').toLowerCase()
  .replace(/[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const tokens = (value: string): Set<string> => new Set(normalized(value).split(' ').filter((word) => word.length >= 2));
const includesProject = (value: string, project: string): boolean => (` ${normalized(value)} `).includes(` ${normalized(project)} `);
const bound = (value: number | undefined, fallback: number, ceiling: number): number =>
  value !== undefined && Number.isFinite(value) ? Math.max(1, Math.min(ceiling, Math.floor(value))) : fallback;
const parse = (value: string): Record<string, unknown> | undefined => {
  try { return object(JSON.parse(value)); } catch { return undefined; }
};
const rows = (value: string): Record<string, unknown>[] => value.split('\n').flatMap((line) => {
  const row = parse(line); return row ? [row] : [];
});
const recordId = (id: string): string => id.replace(/^memory:/, '');
const safeText = (value: string): string => value
  .replace(/-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?(?:-----END[^\n]*PRIVATE KEY-----|$)/g, '[redacted]')
  .replace(/\b(?:sk-[\w-]{8,}|gh[pousr]_[\w]{12,}|github_pat_[\w]{12,}|xox[baprs]-[\w-]{10,}|AKIA[A-Z0-9]{16})\b/g, '[redacted]')
  .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[redacted]')
  .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [redacted]')
  .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|authorization)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[redacted]')
  .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** Local metadata recall only. Never opens paths named by a memory record or vault node. */
export class AsmMemoryService {
  private readonly root: string;
  private readonly projects: Readonly<Record<string, AsmMemoryScope>>;
  private readonly maxResults: number;
  private readonly maxExcerptChars: number;
  private readonly maxFileBytes: number;

  constructor(options: AsmMemoryOptions = {}) {
    this.root = options.root ?? path.join(os.homedir(), '.asm');
    this.projects = { ...options.projectScopes, ...DEFAULT_PROJECTS };
    this.maxResults = bound(options.maxResults, 6, 20);
    this.maxExcerptChars = bound(options.maxExcerptChars, 600, 1500);
    this.maxFileBytes = bound(options.maxFileBytes, 64 * 1024 * 1024, 128 * 1024 * 1024);
  }

  async search(query: string, options: AsmMemorySearchOptions): Promise<readonly AsmMemoryCitation[]> {
    if (options.scope !== 'company' && options.scope !== 'personal') return [];
    const wanted = tokens(query.slice(0, 1000));
    if (!wanted.size) return [];
    const project = options.project?.trim();
    if (project && !Object.entries(this.projects).some(([name, scope]) => normalized(name) === normalized(project) && scope === options.scope)) return [];
    const [brainText, memoryText, lifecycleText] = await Promise.all(
      ['brain.json', 'memory.jsonl', 'lifecycle.jsonl'].map((file) => this.read(file)),
    );
    // An unreadable/oversized ledger cannot safely establish whether records are current.
    if (brainText === undefined || memoryText === undefined || lifecycleText === undefined) return [];
    const memories = rows(memoryText);
    const states = this.lifecycle(memories, rows(lifecycleText));
    const brain = parse(brainText);
    const nodes = Array.isArray(brain?.nodes) ? brain.nodes.flatMap((node) => { const row = object(node); return row ? [row] : []; }) : [];
    const candidates: { citation: AsmMemoryCitation; score: number }[] = [];
    for (const source of ['vault', 'memory'] as const) {
      for (const row of source === 'vault' ? nodes : memories) {
        if (source === 'vault' && (row.layer !== 'vault' || row.kind !== 'page')) continue;
        const id = text(row.id);
        if (!id) continue;
        const meta = object(row.meta) ?? {};
        const title = source === 'vault' ? text(row.label) : text(row.summary);
        const description = source === 'vault' ? text(meta.description) || text(row.description) : text(row.details);
        const paths = source === 'vault' ? [text(row.path)] : strings(row.files);
        const content = [title, description, ...paths, text(row.project), text(meta.project), ...strings(meta.tags)].join('\n');
        if (this.scope(content, row.scope ?? meta.scope) !== options.scope || (project && !includesProject(content, project))) continue;
        const state = states.get(source === 'memory' ? `record:${recordId(id)}` : `page:${id}`);
        if (state?.status === 'closed' || state?.status === 'retired') continue;
        const terms = tokens(content), titleTerms = tokens(title);
        let score = 0;
        for (const word of wanted) if (terms.has(word)) score += titleTerms.has(word) ? 3 : 1;
        if (!score) continue;
        const date = source === 'vault' ? text(meta.updatedAt) : text(row.created_at);
        candidates.push({ score, citation: {
          source, id: safeText(source === 'memory' ? `memory:${recordId(id)}` : id).slice(0, 240),
          title: safeText(title).slice(0, 240), excerpt: safeText(description || title).slice(0, this.maxExcerptChars),
          path: safeText(paths[0] || '').slice(0, 500),
          ...(date.length <= 40 && /^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/.test(date) && Number.isFinite(Date.parse(date)) ? { date } : {}),
          status: state?.status === 'done' ? 'done' : 'active',
        } });
      }
    }
    return candidates.sort((a, b) => b.score - a.score || Date.parse(b.citation.date ?? '1970-01-01') - Date.parse(a.citation.date ?? '1970-01-01') || a.citation.id.localeCompare(b.citation.id))
      .slice(0, this.maxResults).map(({ citation }) => citation);
  }

  private scope(content: string, explicit: unknown): AsmMemoryScope | undefined {
    const found = new Set<AsmMemoryScope>();
    if (explicit === 'company' || explicit === 'personal') found.add(explicit);
    for (const [project, scope] of Object.entries(this.projects)) if (normalized(project) && includesProject(content, project)) found.add(scope);
    return found.size === 1 ? [...found][0] : undefined;
  }

  private async read(file: string): Promise<string | undefined> {
    try {
      const handle = await open(path.join(this.root, file), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > this.maxFileBytes) return undefined;
        const buffer = Buffer.alloc(stat.size + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > stat.size) return undefined;
        return buffer.toString('utf8', 0, bytesRead);
      } finally { await handle.close(); }
    } catch (error: unknown) {
      return object(error)?.code === 'ENOENT' ? '' : undefined;
    }
  }

  private lifecycle(memories: readonly Record<string, unknown>[], operations: readonly Record<string, unknown>[]): Map<string, AsmLifecycleState> {
    const states = new Map<string, AsmLifecycleState>();
    const before = new Map<string, AsmLifecycleState | undefined>();
    const seen = new Map<string, Record<string, unknown>>();
    const visibility: Readonly<Record<string, AsmLifecycleState['status']>> = { close_thread: 'closed', mark_done: 'done', retire: 'retired' };
    for (const row of memories) for (const old of strings(row.supersedes)) {
      states.set(`record:${recordId(old)}`, { status: 'retired', operation: `supersedes:${text(row.id)}` });
    }
    for (const operation of operations) {
      const id = text(operation.id), op = text(operation.op), target = object(operation.target);
      if (!id.startsWith('lc_') || !target || !text(target.id).trim() || !text(operation.reason).trim() || seen.has(id)
        || !['thread', 'record', 'page', 'memory_file', 'index_line'].includes(text(target.kind))
        || !['close_thread', 'mark_done', 'retire', 'restore', 'correct', 'compact'].includes(op)
        || ['ts', 'undoes', 'applies'].some((field) => field in operation && typeof operation[field] !== 'string')
        || (op === 'restore' && !text(operation.undoes).startsWith('lc_'))) continue;
      const key = `${text(target.kind)}:${target.kind === 'record' ? recordId(text(target.id)) : text(target.id)}`;
      seen.set(id, operation);
      const status = visibility[op];
      if (status) {
        before.set(id, states.get(key));
        states.set(key, { status, operation: id });
      } else if (op === 'restore') {
        const undone = seen.get(text(operation.undoes)), previousTarget = object(undone?.target);
        if (!undone || !previousTarget || !visibility[text(undone.op)]) continue;
        const previousKey = `${text(previousTarget.kind)}:${previousTarget.kind === 'record' ? recordId(text(previousTarget.id)) : text(previousTarget.id)}`;
        if (states.get(previousKey)?.operation !== undone.id) continue;
        const previous = before.get(text(undone.id));
        if (previous) states.set(previousKey, previous); else states.delete(previousKey);
      }
    }
    return states;
  }
}

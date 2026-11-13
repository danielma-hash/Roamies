export type AsmMemoryScope = 'company' | 'personal';

export interface AsmMemoryOptions {
  readonly root?: string;
  readonly projectScopes?: Readonly<Record<string, AsmMemoryScope>>;
  readonly maxResults?: number;
  readonly maxExcerptChars?: number;
  readonly maxFileBytes?: number;
}

export interface AsmMemorySearchOptions {
  readonly scope: AsmMemoryScope;
  readonly project?: string;
}

export interface AsmMemoryCitation {
  readonly source: 'vault' | 'memory';
  readonly id: string;
  readonly title: string;
  readonly excerpt: string;
  readonly path: string;
  readonly date?: string;
  readonly status: 'active' | 'done';
}

export interface AsmLifecycleState {
  readonly status: 'closed' | 'retired' | 'done';
  readonly operation: string;
}

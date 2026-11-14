import type { Options, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeRunJournal } from './claude-run-journal.js';
import type { ProjectContextReceipt } from './project-context.types.js';
import type { AsmMemoryService } from './asm-memory.service.js';
import type { AsmMemoryScope } from './asm-memory.types.js';

export type ClaudeRunState = 'starting' | 'running' | 'waiting' | 'idle' | 'stopped' | 'failed' | 'interrupted';
export interface ClaudeRunSnapshot {
  readonly id: string;
  readonly title: string;
  readonly cwd: string;
  readonly state: ClaudeRunState;
  readonly queued: number;
  readonly lastReply: string;
  readonly error?: string;
  readonly updatedAt?: number;
  readonly recoveryInstructions?: readonly string[];
  readonly projectContext?: ProjectContextReceipt;
  readonly memoryScope?: { readonly project: string; readonly scope: AsmMemoryScope };
}
export interface ClaudeRunOptions {
  readonly journal?: ClaudeRunJournal;
  readonly memory?: AsmMemoryService;
  readonly executable: () => string;
  readonly env?: () => Record<string, string | undefined>;
  readonly allowActions: () => boolean;
  readonly confirm: (question: string, signal: AbortSignal) => Promise<boolean>;
  readonly query: (input: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;
  readonly activeSessionIds: () => Promise<readonly string[]>;
}

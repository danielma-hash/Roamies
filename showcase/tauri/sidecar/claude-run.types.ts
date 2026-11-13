import type { Options, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

export type ClaudeRunState = 'starting' | 'running' | 'waiting' | 'idle' | 'stopped' | 'failed';
export interface ClaudeRunSnapshot {
  readonly id: string;
  readonly title: string;
  readonly cwd: string;
  readonly state: ClaudeRunState;
  readonly queued: number;
  readonly lastReply: string;
  readonly error?: string;
}
export interface ClaudeRunOptions {
  readonly executable: () => string;
  readonly env?: () => Record<string, string | undefined>;
  readonly allowActions: () => boolean;
  readonly confirm: (question: string, signal: AbortSignal) => Promise<boolean>;
  readonly query: (input: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;
  readonly activeSessionIds: () => Promise<readonly string[]>;
}

import type { ClaudeRunSnapshot } from './claude-run.types.js';
import type { ClaudeSession } from './claude-sessions.types.js';

export type SessionFilter = 'all' | 'active' | 'attention' | 'interrupted' | 'history';
export interface SessionCenterRow {
  readonly id: string;
  readonly title: string;
  readonly cwd: string;
  readonly state: ClaudeRunSnapshot['state'] | ClaudeSession['status'];
  readonly updatedAt: number;
  readonly managed: boolean;
  readonly run?: ClaudeRunSnapshot;
}
export interface SessionCenterSnapshot {
  readonly runs: readonly ClaudeRunSnapshot[];
  readonly sessions: readonly ClaudeSession[];
  readonly observedAt: number;
  readonly actions: boolean;
  readonly error?: string;
}

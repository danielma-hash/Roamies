export type ClaudeSessionStatus = 'running' | 'waiting' | 'idle' | 'ended' | 'unknown';

export interface ClaudeSession {
  readonly id: string;
  readonly title: string;
  readonly cwd: string;
  readonly branch: string;
  readonly updatedAt: number;
  readonly status: ClaudeSessionStatus;
  readonly eventAt?: number;
}

export interface ClaudeSessionMetadata {
  readonly sessionId: string;
  readonly summary: string;
  readonly customTitle?: string;
  readonly cwd?: string;
  readonly gitBranch?: string;
  readonly lastModified: number;
  readonly fileSize?: number;
}

export interface ClaudeSessionsAdapter {
  readonly listSessions?: (options: { limit: number; dir?: string }) => Promise<readonly ClaudeSessionMetadata[]>;
  readonly getSessionMessages?: (id: string, options: { dir?: string; includeSystemMessages: false }) => Promise<readonly {
    readonly type: string;
    readonly message: unknown;
  }[]>;
  readonly forkSession?: (id: string, options: { dir?: string; title?: string }) => Promise<{ sessionId: string }>;
}

export interface ClaudeSessionsOptions {
  readonly sdk?: ClaudeSessionsAdapter;
  readonly eventsDirectory?: string;
  readonly now?: () => number;
  readonly readEvent?: (file: string) => Promise<unknown>;
}

export interface ClaudeSessionListOptions {
  readonly query?: string;
  readonly project?: string;
  readonly limit?: number;
}

export interface ClaudeSessionList {
  readonly available: boolean;
  readonly sessions: readonly ClaudeSession[];
  readonly message?: string;
}

export interface ClaudeTranscript {
  readonly session: ClaudeSession;
  readonly messages: readonly { readonly role: 'user' | 'assistant'; readonly text: string }[];
  readonly truncated: boolean;
}

export type ClaudeEventName = 'SessionStart' | 'UserPromptSubmit' | 'PermissionRequest' | 'Notification' | 'Stop' | 'SessionEnd';

export interface ClaudeEvent {
  readonly sessionId: string;
  readonly cwd: string;
  readonly event: ClaudeEventName;
  readonly timestamp: number;
  readonly pid?: number;
}

export interface ClaudeEventOptions {
  readonly directory?: string;
  readonly now?: () => number;
}

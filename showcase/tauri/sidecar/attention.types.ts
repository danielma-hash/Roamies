export interface AttentionOptions {
  readonly filePath: string;
  readonly now?: () => number;
}

export interface AttentionPreferences {
  readonly quiet: boolean;
  readonly focus: boolean;
}

export type AttentionKind = 'session-waiting' | 'session-ended' | 'checks-failed' | 'checks-passed';

export interface AttentionEvent {
  readonly id: string;
  readonly kind: AttentionKind;
  readonly sourceId: string;
  readonly title: string;
  readonly createdAt: number;
  readonly url?: string;
  readonly dismissedAt?: number;
}

export interface AttentionSnapshot {
  readonly preferences: AttentionPreferences;
  readonly unread: number;
  readonly events: readonly AttentionEvent[];
}

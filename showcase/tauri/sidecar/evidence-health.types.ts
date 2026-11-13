export type EvidenceHealthStageId = 'stt' | 'request' | 'tools' | 'tts' | 'playback';
export type EvidenceHealthError = 'hearing-error' | 'request-error' | 'request-stalled' | 'tool-error' | 'speech-error' | 'playback-error';

export interface EvidenceHealthOptions {
  readonly now?: () => number;
}

export interface EvidenceHealthStage {
  readonly id: EvidenceHealthStageId;
  readonly state: 'unknown' | 'ok' | 'error';
  readonly observedAt?: number;
  readonly durationMs?: number;
  readonly evidence?: string;
  readonly error?: EvidenceHealthError;
}

export interface EvidenceHealthOperation {
  readonly id: string;
  readonly name: string;
  readonly state: 'running' | 'completed' | 'verified' | 'error';
  readonly observedAt: number;
  readonly durationMs?: number;
  readonly verifiedAt?: number;
}

export interface EvidenceHealthSnapshot {
  readonly stages: readonly EvidenceHealthStage[];
  readonly operations: readonly EvidenceHealthOperation[];
}

export interface AsmIndexSnapshot {
  readonly revision: number;
  readonly nodes: readonly Record<string, unknown>[];
  readonly memories: readonly Record<string, unknown>[];
  readonly operations: readonly Record<string, unknown>[];
}

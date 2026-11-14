import type { SessionFilter } from './session-center.types.js';

export interface DraftStorage {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}
export interface SessionViewState {
  readonly version: 1;
  readonly selected?: string;
  readonly filter: SessionFilter;
  readonly query: string;
  readonly drafts: readonly (readonly [string, string])[];
}
export interface ViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

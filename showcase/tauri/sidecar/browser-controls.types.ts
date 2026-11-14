export interface BrowserControl {
  readonly ref: string; readonly role: string; readonly name: string; readonly value: string;
  readonly actions: readonly ('click' | 'fill')[];
}
export interface BrowserControlTarget {
  readonly jobId: string; readonly source: string; readonly frameId: string; readonly loaderId: string;
  readonly frameUrl: string; readonly backendNodeId: number; readonly role: string; readonly name: string;
  readonly signature: string; readonly action: 'click' | 'fill'; readonly text?: string;
}
export interface BrowserControlsOptions {
  readonly inspect: (jobId: string, signal?: AbortSignal) => Promise<unknown>;
  readonly apply: (target: BrowserControlTarget, signal?: AbortSignal) => Promise<unknown>;
  readonly read: (jobId: string, signal?: AbortSignal) => Promise<unknown>;
  readonly allowActions: () => boolean;
  readonly confirm: (question: string, signal?: AbortSignal) => Promise<boolean>;
  readonly now?: () => number;
}

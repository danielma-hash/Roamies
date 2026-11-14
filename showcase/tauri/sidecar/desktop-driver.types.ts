export interface DesktopPolicy {
  readonly windowId: number; readonly pid: number; readonly bundle: string; readonly app: string;
  readonly instance: string; readonly title: string; readonly protected: boolean; readonly trusted: boolean;
}
export interface DesktopElement {
  readonly ref?: string; readonly role: string; readonly name: string; readonly value: string;
  readonly actions: readonly string[]; readonly states: readonly string[];
}
export interface DesktopSnapshot {
  readonly windowId: number; readonly title: string; readonly elements: readonly DesktopElement[];
  readonly truncated: boolean; readonly observedAt: string; readonly untrustedContent: true;
}
export interface DesktopDriverOptions {
  readonly run: (args: readonly string[], input?: string, signal?: AbortSignal) => Promise<unknown>;
  readonly policy: (windowId: number) => Promise<unknown>;
  readonly allowActions: () => boolean;
  readonly confirm: (text: string, signal?: AbortSignal) => Promise<boolean>;
  readonly now?: () => number;
}
export interface DesktopAction {
  readonly ref: string; readonly action: 'click' | 'fill'; readonly text?: string;
}

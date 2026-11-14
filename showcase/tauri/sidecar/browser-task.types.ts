export interface BrowserTaskOptions {
  readonly docker: (args: readonly string[], input?: string, signal?: AbortSignal) => Promise<string>;
  readonly ownerId: string;
  readonly hostSubnets: () => readonly string[];
  readonly now?: () => number;
}
export interface BrowserPage {
  readonly jobId: string; readonly source: string; readonly title: string; readonly text: string;
  readonly queryFound?: boolean; readonly nextOffset?: number; readonly truncated: boolean;
  readonly links: readonly { readonly text: string; readonly url: string }[];
  readonly tables: readonly (readonly (readonly string[])[])[];
  readonly observedAt: string; readonly expiresAt: string; readonly untrustedContent: true;
}
export interface BrowserReadInput { readonly jobId: string; readonly query?: string; readonly offset?: number; }

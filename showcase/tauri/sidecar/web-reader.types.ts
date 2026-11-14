import type { LookupAddress } from 'node:dns';
import type { Agent } from 'undici';

export interface WebDocument {
  readonly title: string;
  readonly text: string;
  readonly tables: readonly (readonly (readonly string[])[])[];
  readonly truncated: boolean;
}
export interface WebReadInput {
  readonly url: string;
  readonly query?: string;
  readonly offset?: number;
  readonly limit?: number;
}
export interface WebReadResult {
  readonly source: string;
  readonly title: string;
  readonly fetchedAt: string;
  readonly cached: boolean;
  readonly text: string;
  readonly offset: number;
  readonly nextOffset?: number;
  readonly queryFound?: boolean;
  readonly tables: WebDocument['tables'];
  readonly truncated: boolean;
  readonly untrustedContent: true;
}
export interface WebReaderOptions {
  readonly resolve?: (host: string) => Promise<readonly LookupAddress[]>;
  readonly fetch?: (url: string, init: RequestInit & { readonly dispatcher: Agent }) => Promise<Response>;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
}

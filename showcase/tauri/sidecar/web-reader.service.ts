import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';
import { z } from 'zod';
// @ts-expect-error Existing app safety module is JavaScript.
import { checkUrl, isPrivateAddress, SAFE } from './safety.mjs';
import { parseWebDocument } from './web-document.js';
import type { WebDocument, WebReaderOptions, WebReadInput, WebReadResult } from './web-reader.types.js';

const input = z.object({ url: z.string().min(1).max(8000), query: z.string().max(200).optional(), offset: z.number().int().min(0).max(200_000).optional(), limit: z.number().int().min(200).max(8000).optional() });
export class WebReadError extends Error { override readonly name = 'WebReadError'; }
interface CachedDocument { readonly source: string; readonly document: WebDocument; readonly fetchedAt: number; }
function allowed(url: string): void {
  const result = checkUrl(url); if (result.level !== SAFE) throw new WebReadError(result.reason ?? 'הכתובת אינה מורשית לקריאה.');
}
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export class WebReaderService {
  private readonly cache = new Map<string, CachedDocument>();
  constructor(private readonly options: WebReaderOptions = {}) {}
  async read(value: WebReadInput, signal?: AbortSignal): Promise<WebReadResult> {
    const request = input.parse(value); allowed(request.url); signal?.throwIfAborted();
    const key = new URL(request.url).href; const previous = this.cache.get(key);
    const cached = !!previous && Date.now() - previous.fetchedAt < 60_000;
    const entry = cached ? previous : await this.download(key, signal);
    if (!cached) { this.cache.delete(key); this.cache.set(key, entry); while (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!); }
    const limit = request.limit ?? 5000; let offset = request.offset ?? 0;
    const found = request.query ? entry.document.text.toLocaleLowerCase().indexOf(request.query.toLocaleLowerCase(), offset) : -1;
    if (found >= 0) offset = Math.max(offset, found - 150);
    const end = offset + limit;
    return { source: entry.source, title: entry.document.title, fetchedAt: new Date(entry.fetchedAt).toISOString(), cached,
      text: entry.document.text.slice(offset, end), offset, ...(end < entry.document.text.length ? { nextOffset: end } : {}),
      ...(request.query ? { queryFound: found >= 0 } : {}), tables: entry.document.tables, truncated: entry.document.truncated, untrustedContent: true };
  }
  private async download(start: string, parent?: AbortSignal): Promise<CachedDocument> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 20_000);
    const signal = parent ? AbortSignal.any([parent, timeout]) : timeout;
    const maxBytes = this.options.maxBytes ?? 2_000_000;
    let url = start;
    for (let hop = 0; hop <= 5; hop++) {
      allowed(url); const parsed = new URL(url); const host = parsed.hostname.replace(/^\[|\]$/g, '');
      const addresses = await abortable((this.options.resolve ?? ((name) => lookup(name, { all: true })))(host), signal);
      if (!addresses.length || addresses.some(({ address }) => !isIP(address) || isPrivateAddress(address))) throw new WebReadError('הכתובת מובילה לרשת פרטית או שלא ניתן לאמת אותה.');
      const pinned = addresses.find(({ family }) => family === 4) ?? addresses[0]!;
      // The connection uses this checked address, not another DNS lookup (rebinding).
      const dispatcher = new Agent({ connect: { autoSelectFamily: false, lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family) }, maxHeaderSize: 16_384 });
      try {
        const response = await (this.options.fetch ?? fetch)(url, { dispatcher, redirect: 'manual', signal, headers: { 'user-agent': 'Roamies-Sidekick', accept: 'text/html,text/plain,application/json' } });
        const location = response.headers.get('location');
        if (response.status >= 300 && response.status < 400 && location) {
          await response.body?.cancel(); if (hop === 5) throw new WebReadError('יותר מדי הפניות בין דפים.');
          url = new URL(location, url).href; continue;
        }
        if (!response.ok) { await response.body?.cancel(); throw new WebReadError(`האתר החזיר שגיאת HTTP ${response.status}.`); }
        const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
        if (!['text/html', 'application/xhtml+xml', 'text/plain', 'application/json'].includes(mime)) { await response.body?.cancel(); throw new WebReadError('התוכן אינו דף טקסט נתמך.'); }
        if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new WebReadError('הדף גדול ממגבלת הקריאה.'); }
        const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
        if (reader) {
          try {
            for (;;) { signal.throwIfAborted(); const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength;
              if (bytes > maxBytes) throw new WebReadError('הדף גדול ממגבלת הקריאה.'); chunks.push(next.value); }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
        const document = parseWebDocument(Buffer.concat(chunks).toString('utf8'), mime.includes('html'));
        return { source: url, document, fetchedAt: Date.now() };
      } finally { await dispatcher.destroy(); }
    }
    throw new WebReadError('לא ניתן לקרוא את הדף.');
  }
}

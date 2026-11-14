import { expect, it, vi } from 'vitest';
import { WebReaderService } from '../web-reader.service.js';
import { parseWebDocument } from '../web-document.js';
import type { WebReaderOptions } from '../web-reader.types.js';
const publicDns = async () => [{ address: '93.184.215.14', family: 4 }];
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
it('extracts inert Hebrew text, title and tables without executing or including scripts', () => {
  const doc = parseWebDocument('<title>השוואה &amp; בדיקה</title><style>secret</style><script>danger()</script><template>hidden</template><p>שלום Jarvis</p><table><tr><th>שם</th><th>ערך</th></tr><tr><td>מקור</td><td>42</td></tr></table>', true);
  expect(doc.title).toBe('השוואה & בדיקה'); expect(doc.text).toContain('שלום Jarvis');
  expect(doc.text).not.toMatch(/secret|danger|hidden/); expect(doc.tables).toEqual([[['שם', 'ערך'], ['מקור', '42']]]);
  expect(parseWebDocument('<table>'+ '<tr><td>'.concat('a'.repeat(200), '</td></tr>').repeat(1000) + '</table>', true).tables.flat(2).join('').length).toBeLessThanOrEqual(4000);
});
it('uses short cached pages and focused passages without another HTTP request', async () => {
  const fetch = vi.fn<WebReaderOptions['fetch'] & {}>(async () => html(`<title>source</title><p>${'x'.repeat(800)} מילה חשובה ${'y'.repeat(800)}</p>`));
  const service = new WebReaderService({ resolve: publicDns, fetch });
  const first = await service.read({ url: 'https://example.com', limit: 200 });
  expect(first.text).toHaveLength(200); expect(first.nextOffset).toBe(200); expect(first.untrustedContent).toBe(true);
  const next = await service.read({ url: 'https://example.com', query: 'מילה', limit: 200 });
  expect(next.text).toContain('מילה'); expect(next.cached).toBe(true); expect(next.queryFound).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
});
it('blocks literal private hosts, private DNS and redirects into the local network', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }));
  const service = new WebReaderService({ resolve: publicDns, fetch });
  await expect(service.read({ url: 'http://127.0.0.1' })).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  await expect(new WebReaderService({ resolve: async () => [{ address: '127.0.0.1', family: 4 }], fetch }).read({ url: 'https://example.com' })).rejects.toThrow('פרטית'); expect(fetch).not.toHaveBeenCalled();
  await expect(service.read({ url: 'https://example.com' })).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
});
it('rechecks every redirect host and fails closed for empty or mixed DNS answers', async () => {
  const resolve = vi.fn(async (host: string) => host === 'other.example' ? [{ address: '10.0.0.1', family: 4 }] : await publicDns());
  const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://other.example' } }));
  await expect(new WebReaderService({ resolve, fetch }).read({ url: 'https://example.com' })).rejects.toThrow();
  expect(resolve.mock.calls.map(([host]) => host)).toEqual(['example.com', 'other.example']); expect(fetch).toHaveBeenCalledTimes(1);
  for (const addresses of [[], [...await publicDns(), { address: '::1', family: 6 }]]) {
    await expect(new WebReaderService({ resolve: async () => addresses, fetch }).read({ url: 'https://example.com' })).rejects.toThrow();
  }
});
it('limits streamed bytes even without content-length and cancels the response', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(80)); }, cancel });
  const service = new WebReaderService({ maxBytes: 100, resolve: publicDns, fetch: async () => new Response(body, { headers: { 'content-type': 'text/plain' } }) });
  await expect(service.read({ url: 'https://example.com' })).rejects.toThrow('גדול'); expect(cancel).toHaveBeenCalled();
});
it('rejects oversized declared content, non-text types and HTTP errors', async () => {
  for (const response of [new Response('x', { headers: { 'content-type': 'text/html', 'content-length': '9999999' } }), new Response('x', { headers: { 'content-type': 'application/octet-stream' } }), new Response('not found', { status: 404 })]) {
    await expect(new WebReaderService({ resolve: publicDns, fetch: async () => response }).read({ url: 'https://example.com' })).rejects.toThrow();
  }
});
it('honors cancellation before a call and during DNS resolution', async () => {
  const controller = new AbortController(); const fetch = vi.fn(async () => html('ok'));
  const service = new WebReaderService({ resolve: () => new Promise(() => {}), fetch });
  const read = service.read({ url: 'https://example.com' }, controller.signal); controller.abort();
  await expect(read).rejects.toThrow(); await expect(service.read({ url: 'https://example.com' }, controller.signal)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});

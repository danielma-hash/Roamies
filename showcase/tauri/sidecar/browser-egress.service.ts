import http from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import { browserConnectHost, publicBrowserAddress } from './browser-address-policy.js';
import type { BrowserEgressOptions } from './browser-egress.types.js';

export class BrowserEgressError extends Error { override readonly name = 'BrowserEgressError'; }

/** One short-lived job's HTTPS proxy. Browser must sit on an isolated Docker internal network;
 * this process alone joins an egress network. It must never be published on the host.
 */
export class BrowserEgressService {
  private readonly server: http.Server;
  private readonly sockets = new Set<Duplex>();
  private readonly maxBytes: number;
  private bytes = 0;
  private closed = false;
  constructor(private readonly options: BrowserEgressOptions) {
    if (!options.deniedAddresses.length || !options.deniedAddresses.every((ip) => publicBrowserAddress(ip))) throw new BrowserEgressError('public egress identity is required');
    this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    this.server = http.createServer({ maxHeaderSize: 8192 }, (request, response) => {
      // Readiness only, no address, credentials, file access or outbound request.
      if (request.method === 'GET' && request.url === '/health') { response.writeHead(this.closed ? 503 : 200); response.end('ready'); }
      else { response.writeHead(405); response.end('HTTPS CONNECT required'); }
    });
    this.server.headersTimeout = 5000; this.server.requestTimeout = 5000; this.server.keepAliveTimeout = 1000; this.server.maxHeadersCount = 32; this.server.maxConnections = 32;
    this.server.on('connection', (socket) => { this.track(socket); socket.setTimeout(this.options.idleMs ?? 15_000, () => socket.destroy()); });
    this.server.on('connect', (request, socket, head) => { void this.tunnel(request.url ?? '', socket, head); });
    this.server.on('upgrade', (_request, socket) => socket.destroy());
    this.server.on('clientError', (_error, socket) => socket.destroy());
  }
  private track(socket: Duplex): void {
    this.sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => this.sockets.delete(socket));
  }
  private async addresses(host: string): Promise<readonly string[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const values = await Promise.race([this.options.resolve(host), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BrowserEgressError('DNS timeout')), 3000); })]);
      if (!values.length || values.length > 32 || !values.every((ip) => publicBrowserAddress(ip, this.options.deniedAddresses, this.options.deniedSubnets))) throw new BrowserEgressError('non-public destination');
      return values;
    } finally { clearTimeout(timer); }
  }
  private async tunnel(authority: string, client: Duplex, head: Buffer): Promise<void> {
    client.pause();
    try {
      if (this.closed || this.bytes >= this.maxBytes) throw new BrowserEgressError('budget exhausted');
      const host = browserConnectHost(authority);
      const addresses = await this.addresses(host);
      if (client.destroyed || this.closed) return;
      // Literal checked IP: there is deliberately no second DNS lookup in connect().
      const upstream = this.options.dial ? this.options.dial(addresses[0]) : connect({ host: addresses[0], port: 443, family: 4 });
      this.track(upstream);
      const stop = () => { client.destroy(); upstream.destroy(); };
      const deadline = setTimeout(stop, 90_000); deadline.unref();
      upstream.setTimeout(this.options.idleMs ?? 15_000, stop);
      client.once('close', () => { clearTimeout(deadline); upstream.destroy(); });
      upstream.once('close', () => { clearTimeout(deadline); client.destroy(); });
      upstream.once('error', stop);
      let tunnelBytes = head.length;
      const count = (chunk: Buffer) => {
        tunnelBytes += chunk.length; this.bytes += chunk.length;
        if (tunnelBytes > 32 * 1024 * 1024 || this.bytes > this.maxBytes) { void this.close(); }
      };
      upstream.once('connect', () => {
        if (this.closed || client.destroyed) { stop(); return; }
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        this.bytes += head.length;
        if (this.bytes > this.maxBytes) { void this.close(); return; }
        if (head.length) upstream.write(head);
        client.on('data', count); upstream.on('data', count);
        client.pipe(upstream); upstream.pipe(client); client.resume();
      });
    } catch {
      if (!client.destroyed) client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    }
  }
  async listen(port = 0, host = '127.0.0.1'): Promise<number> {
    if (this.closed) throw new BrowserEgressError('proxy closed');
    await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(port, host, () => { this.server.removeListener('error', reject); resolve(); }); });
    const address = this.server.address(); if (!address || typeof address === 'string') throw new BrowserEgressError('no listening address'); return address.port;
  }
  async close(): Promise<void> {
    this.closed = true; for (const socket of this.sockets) socket.destroy();
    if (this.server.listening) await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

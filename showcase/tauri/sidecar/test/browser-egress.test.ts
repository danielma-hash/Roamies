import { connect, createServer } from 'node:net';
import { expect, it, vi } from 'vitest';
import { browserConnectHost, publicBrowserAddress } from '../browser-address-policy.js';
import { BrowserEgressService } from '../browser-egress.service.js';

it('permits public IPv4 but rejects private, special, mapped, scoped and home addresses', () => {
  expect(publicBrowserAddress('93.184.215.14')).toBe(true);
  for (const address of ['0.0.0.0','10.1.2.3','100.64.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.0.0.1','192.0.2.1','192.88.99.1','192.168.1.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','::ffff:127.0.0.1','2001:4860:4860::8888','fe80::1%en0','example.com','2130706433']) expect(publicBrowserAddress(address), address).toBe(false);
  expect(publicBrowserAddress('93.184.215.14', ['93.184.215.14'])).toBe(false);
  expect(publicBrowserAddress('93.184.215.14', [], ['93.184.215.0/24'])).toBe(false);
  expect(publicBrowserAddress('93.184.215.14', [], ['broken'])).toBe(false);
});
it('accepts only HTTPS CONNECT authority without credentials, path, IPv6 or alternate ports', () => {
  expect(browserConnectHost('example.com:443')).toBe('example.com');
  for (const authority of ['example.com:80','example.com:22','user@example.com:443','example.com:443/path','example.com:443#x','[::1]:443','127.0.0.1:443','2130706433:443','0177.0.0.1:443','host.docker.internal:443','localhost:443','x\r\nHost: evil:443']) expect(() => browserConnectHost(authority), authority).toThrow();
});
function request(port: number, authority: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port }); let result = '';
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('fixture timeout')); });
    socket.on('connect', () => socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
    socket.on('data', (chunk) => { result += chunk.toString(); if (result.includes('\r\n\r\n')) socket.end(); });
    socket.on('close', () => resolve(result)); socket.on('error', reject);
  });
}
it('fails closed on empty, private or mixed DNS and refuses ordinary HTTP without forwarding', async () => {
  for (const addresses of [[], ['127.0.0.1'], ['93.184.215.14','10.0.0.1'], ['8.8.8.8']]) {
    const resolve = vi.fn(async () => addresses);
    const proxy = new BrowserEgressService({ resolve, deniedAddresses: ['8.8.8.8'] });
    try {
      const port = await proxy.listen(); expect(await request(port, 'example.com:443')).toContain('403 Forbidden'); expect(resolve).toHaveBeenCalledWith('example.com');
      expect((await fetch(`http://127.0.0.1:${port}/external`)).status).toBe(405);
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    } finally { await proxy.close(); }
  }
});
it('validates authority before DNS and requires a verified public egress identity', async () => {
  const resolve = vi.fn(async () => ['93.184.215.14']);
  expect(() => new BrowserEgressService({ resolve, deniedAddresses: [] })).toThrow();
  const proxy = new BrowserEgressService({ resolve, deniedAddresses: ['8.8.8.8'] });
  try { const port = await proxy.listen(); expect(await request(port, 'example.com:22')).toContain('403 Forbidden'); expect(resolve).not.toHaveBeenCalled(); }
  finally { await proxy.close(); }
});
it('dials the exact checked address once and closes the job when its byte budget is exceeded', async () => {
  // The test transport alone maps the checked public IP to an owned loopback fixture.
  // The production entry never supplies a dial override.
  const upstream = createServer((socket) => { socket.on('error', () => {}); socket.write(Buffer.alloc(2048, 120)); socket.end(); });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); if (!address || typeof address === 'string') throw new Error('fixture did not listen');
  const dial = vi.fn(() => connect({ host: '127.0.0.1', port: address.port }));
  const resolve = vi.fn(async () => ['93.184.215.14']);
  const proxy = new BrowserEgressService({ resolve, deniedAddresses: ['8.8.8.8'], dial, maxBytes: 128 });
  try {
    const port = await proxy.listen(); await request(port, 'example.com:443');
    expect(dial).toHaveBeenCalledExactlyOnceWith('93.184.215.14'); expect(resolve).toHaveBeenCalledOnce();
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  } finally { await proxy.close(); await new Promise<void>((resolve) => upstream.close(() => resolve())); }
});

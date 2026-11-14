import { BlockList, isIP } from 'node:net';
// @ts-expect-error Existing app safety module is JavaScript.
import { checkUrl, SAFE } from './safety.mjs';

/** First browser release is IPv4-only; reject IPv6 rather than route around local-prefix policy.
 * Range choices follow PacoBot's desktop-link/address-guard (including NAT/Tailscale/test ranges).
 */
export function publicBrowserAddress(address: string, denied: readonly string[] = [], subnets: readonly string[] = []): boolean {
  if (isIP(address) !== 4 || denied.includes(address)) return false;
  const blocked = new BlockList();
  for (const [network, bits] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ] as const) blocked.addSubnet(network, bits, 'ipv4');
  try {
    for (const subnet of subnets) {
      const [network, prefix, extra] = subnet.split('/'); const bits = Number(prefix);
      if (extra !== undefined || prefix === undefined || !/^\d{1,2}$/.test(prefix) || isIP(network) !== 4 || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
      blocked.addSubnet(network, bits, 'ipv4');
    }
  } catch { return false; }
  return !blocked.check(address, 'ipv4');
}

/** CONNECT has an authority, not an arbitrary URL; HTTPS/443 only. */
export function browserConnectHost(authority: string): string {
  if (authority.length > 260 || !/^[a-z\d.-]+:443$/i.test(authority)) throw new Error('unsupported authority');
  const url = new URL(`https://${authority}`);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid authority');
  if (checkUrl(url.href).level !== SAFE) throw new Error('blocked URL');
  return url.hostname;
}

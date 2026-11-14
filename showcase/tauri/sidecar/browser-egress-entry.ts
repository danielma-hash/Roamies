import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BrowserEgressService } from './browser-egress.service.js';
import { publicBrowserAddress } from './browser-address-policy.js';

export async function runBrowserEgress(): Promise<void> {
  const subnets: unknown = JSON.parse(process.env.ROAMIES_HOST_SUBNETS ?? 'null');
  if (!Array.isArray(subnets) || subnets.length > 64 || !subnets.every((entry): entry is string => typeof entry === 'string' && entry.length <= 20)) throw new Error('host network policy is required');
  // Refuse the home's public NAT address as well as private ranges. No account or API key.
  // A short-lived job pins this identity for at most five minutes; failure is closed.
  const response = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('cannot establish public egress identity');
  const reader = response.body.getReader(); let address = '';
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; address += Buffer.from(part.value).toString('utf8'); if (address.length > 64) throw new Error('invalid egress identity'); }
  } finally { await reader.cancel(); }
  address = address.trim(); if (!publicBrowserAddress(address)) throw new Error('invalid egress identity');
  const proxy = new BrowserEgressService({ deniedAddresses: [address], deniedSubnets: subnets, resolve: async (host) => (await lookup(host, { all: true, family: 4 })).map((answer) => answer.address) });
  const shutdown = () => { void proxy.close(); };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  const lifetime = setTimeout(shutdown, 5 * 60_000); lifetime.unref();
  await proxy.listen(3128, '0.0.0.0'); console.log('ready');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runBrowserEgress().catch(() => { console.error('browser egress unavailable'); process.exitCode = 1; });
}

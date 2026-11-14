# Browser Use public-network boundary

This is the network foundation for the browser adapter. It does not register a Jarvis
browser tool yet. The networkless regression harness is documented separately in
`browser-runtime-validation.md`.

Each browser job needs two non-root containers: the browser on a Docker **internal**
bridge with gateway mode **isolated**, and this proxy on that bridge plus an egress
bridge. No host ports, host files, Docker socket, personal browser profile or provider
keys are mounted. Container capabilities are dropped; root filesystems are read-only.
The browser uses the proxy for all schemes, disables Chromium's loopback bypass and
non-proxied UDP, and resolves external target names only through the proxy.

The proxy accepts HTTPS CONNECT on port 443 only. It validates the authority through
Roamies safety policy, resolves IPv4 addresses once, rejects the entire answer set if
any address is private/special/local, and dials a checked **literal IP**. Redirects and
subresources create connections subject to the same policy. Ordinary HTTP, non-443
ports, credentials in the authority, IPv6 and direct websocket upgrades are refused.

The caller supplies a fresh snapshot of the Mac's IPv4 interface CIDRs in
`ROAMIES_HOST_SUBNETS` (JSON array). Those networks are excluded even if they use global
addresses. The proxy also discovers its public NAT IPv4 using the unauthenticated
[ipify endpoint](https://www.ipify.org/) and excludes that address. Identity discovery
failure prevents startup. No discovered address is logged. The job is limited to five
minutes: changing network/NAT during a job requires ending that job and starting a new
one. This is not a claim to identify every routed corporate public prefix.

Limits: 32 incoming connections, 8KB request headers, 3-second DNS deadline, 15-second
idle timeout, 90-second tunnel lifetime, 32MiB per tunnel and 64MiB per job (both directions).
Exceeding the byte budget closes the whole proxy and its active sockets. The host adapter
must also stop its owned browser on cancellation; killing a Browser Use CLI alone is
insufficient. No proxy or container fallback may bypass these restrictions.

## Reproduce

From `showcase/tauri/sidecar`, with Docker running:

```sh
npm run build
docker build -t roamies-browser-use:1.0.4 test/browser-runtime
docker build -f browser-runtime/egress.Dockerfile -t roamies-browser-egress:1 dist
ROAMIES_BROWSER_LIVE=1 npx vitest run test/browser-egress.live.test.ts --silent=false
```

The Node 22 image is digest-pinned. Build context excludes everything except the bundled
proxy. The test creates unique container/network names, never attaches a personal browser,
and removes only its own resources. A Docker version supporting isolated gateway mode is
required; validated locally on Docker Engine 29.7.2. No daemon/firewall settings were changed.
See [Docker networking documentation](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

## Verified on 2026-11-14

- Real Chromium/Browser Use opens public HTTPS through the proxy.
- Raw direct connections from the browser container to the public internet, host gateway,
  cloud metadata and Docker bridge gateway fail.
- CONNECT to loopback, private ranges, metadata, host gateway and a DNS name resolving to
  loopback returns 403. The discovered NAT address is also refused.
- A page navigation to the browser's own CDP endpoint receives the proxy's HTTP rejection,
  not the DevTools JSON. Chromium loopback bypass is disabled.
- Unit tests verify malformed authorities, special ranges, host subnets, mixed/empty DNS,
  exact checked-IP dialing without a second lookup, and byte-budget shutdown.

The initial route is **public HTTPS over IPv4 only**. Authenticated profiles, HTTP-only
sites, IPv6-only sites, host downloads/uploads and arbitrary Python/JavaScript are not
part of this capability. Browser UI actions, refs, task cancellation and the Jarvis tool
adapter require their own integration and live validation.

The address-guard design follows the existing PacoBot desktop-link implementation;
Roamies does not depend on the PacoBot service or copy its account credentials.

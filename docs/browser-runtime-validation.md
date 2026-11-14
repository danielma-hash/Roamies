# Browser Use — validation and integration decision

Date: 2026-11-14. Browser Use **1.0.4**, browser-harness **0.1.13**.

## Decision

Use Browser Use's deterministic CLI/CDP helpers behind a typed TypeScript adapter,
with Jarvis's existing model. Do not expose its Python REPL or CLI MCP directly to
the model, and do not attach the user's Chrome profile. Browser Use is not a sandbox.
The runtime remains disabled in the product until the public-network adapter and its
egress restrictions pass separate tests. This PR supplies the repeatable live test,
not a production browsing capability.

Prefer the inert web reader for public text. Use a browser when JavaScript, interaction
or browser session state is necessary. A second LLM or Browser Use Cloud is not required
for the tested operations. No provider credential is passed into the container.

## Run the permanent regression harness

From `showcase/tauri/sidecar`, with Docker running:

```sh
docker build -t roamies-browser-use:1.0.4 test/browser-runtime
ROAMIES_BROWSER_LIVE=1 npx vitest run test/browser-runtime.live.test.ts --silent=false
```

Normal `npm test` skips this opt-in test. It never downloads or starts a container.
The live test starts a uniquely named container and removes only that container in
`finally`. The image contains Chromium; Python is the third-party runtime, while the
orchestration and assertions are TypeScript. Inline HTML is a permanent regression
fixture, not a shipped UI or model-supplied page.

The boundary is a non-root Docker container with no network, published ports, host
mounts, Docker socket, provider keys or personal profile. Root filesystem is read-only;
temporary profile storage is capped. Capabilities are dropped, privilege escalation
disabled, memory limited to 1 GiB and CPU to 2. Chromium `--no-sandbox` applies only
inside that boundary. It is not a proposal to run unrestricted Chromium on the Mac.

## Observed results

The following passed against real Chromium in Docker, not a browser mock:

- Hebrew static text and table extraction; dynamic text only appears in the browser.
- Accessible text-field discovery, filling mixed Hebrew/English, clicking a button,
  then independently reading the resulting output.
- Navigation changes the document loader ID; the previous backend DOM reference is rejected.
- Synthetic HttpOnly cookie persists within the isolated profile. **This is not a
  verification of a real service's authentication or account integration.**
- A long-running REPL operation is confirmed started, then cancelled by stopping its
  owned container. Killing only the CLI is insufficient for a persistent REPL.
- Public-IP and host-gateway connections fail. `/Users`, host Docker socket and provider
  keys are absent. Container configuration is asserted at runtime.

Three warm extraction samples of the same small fixture (Mac host, Docker Linux):

| Path | Output bytes | Median elapsed time | Scope |
|---|---:|---:|---|
| Inert HTML parser | 203 | 0.30 ms | In-process parse only; no HTTP |
| Browser Use focused DOM | 130 | 174 ms | Includes Docker + CLI roundtrip |
| Browser Use full AX tree | 16,169 | 182 ms | Includes Docker + CLI roundtrip |

These measurements support bounding the browser output instead of returning the entire
AX tree. They **do not** establish end-to-end latency, token savings, subscription cost
or superiority over agent-desktop/hands. The paths contain different information; the
static reader cannot see the script-generated text. Tokens and model cost were not
measured because no model was invoked. Cold startup, larger sites and repeated workloads
need separate measurements; three samples do not support a p95 claim.

## Requirements before production enablement

1. Public browsing requires an isolated egress proxy: reject private, loopback, link-local
   and host addresses, pin checked DNS, and enforce every navigation/subresource hop.
   Networkless test success alone does not prove public-browser isolation.
2. Fixed typed operations only; no arbitrary Python/JavaScript, shell, upload, download,
   host files, profile import, or secrets exposed as a model tool.
3. Reference ownership must include job/tab/document and be invalidated after navigation
   or mutation. Single writer per tab. Unknown delivery must not trigger a retry.
4. Deadline/output/step budgets and cancellation must terminate owned runtime work.
5. Actions use the existing Roamies safety and scoped approval flow. Page text cannot
   grant permissions. Account login is a distinct user-controlled flow.
6. Extend the live suite for SPA/iframe/navigation, authenticated fixtures and proxy bypass
   attempts, then compare hands/agent-desktop on their supported local-app workloads.

Sources: [Browser Use](https://github.com/browser-use/browser-use),
[1.x migration and trust model](https://github.com/browser-use/browser-use/blob/main/MIGRATING.md),
[browser-harness](https://github.com/browser-use/browser-harness).

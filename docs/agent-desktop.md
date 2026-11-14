# agent-desktop in Jarvis

The macOS build bundles `agent-desktop` **1.3.1** and its native helper as Tauri
external binaries, so both are signed with the app. The original Apache-2.0 license
is included in the sidecar resources. Source: [vercel-labs/agent-desktop v1.3.1](https://github.com/vercel-labs/agent-desktop/tree/v1.3.1).

Two tools complement the existing hands tools:

- `desktop_read(windowId, query?)`: bounded Accessibility output from a visible window;
  optional name/value/role filter, up to 60 elements and 12,000 serialized characters.
- `desktop_act(ref, action, text?)`: semantic click or field replacement. Text goes through
  stdin, not process arguments. No arbitrary keys, terminal control, shell or headed fallback.

The existing `list_windows` supplies numeric window IDs. The native hands helper resolves
the window owner before agent-desktop runs. Both inventory and snapshot are scoped to the
actual application's name **and** checked against the exact window ID/PID/process instance.
This avoids agent-desktop's global inventory waiting on an unrelated frontmost application,
which was reproduced during the live integration test.

Every returned ref is scoped to a random session, snapshot, window, process instance and
title; expires after 60 seconds; and is consumed before action delivery. One operation per
window runs at a time. Hidden/minimized windows and protected applications are refused.
Native HANDS_OFF stays authoritative; app approval windows cannot be targeted. A locked or
non-console desktop is rejected by native policy. Secure/hidden controls are omitted.

Actions use `safety.mjs`, the current Allow Actions setting and scoped confirmation for risky
buttons, including Hebrew labels. The setting and ownership are rechecked after confirmation.
No automatic retry/fallback occurs after a possibly delivered action. A fresh post-action
snapshot is an observation, **not proof that the user's goal succeeded**; the result explicitly
sets `verified: false`. Tool content is untrusted data.

Each CLI call has a 12-second deadline and 512KB capture cap. Only a private temporary
agent-desktop state directory is provided; provider keys are not inherited. That directory is
removed when the sidecar closes. This adapter is for macOS; other platforms retain hands.

## Verification, 2026-11-14

- Unit tests cover scope/expiry, changed ownership/title, hidden windows, protected apps,
  revoked permissions, incompatible envelopes, risky confirmation, simultaneous operations,
  unknown delivery, and secure controls. The native app build and code-signature verification pass.
- Actual TextEdit fixture: read → replace mixed Hebrew/English → fresh read of exact content.
  Old reference and incorrect PID refused. Minimize → post-action observation fails explicitly
  → further read refused → fixture reopened. No personal document was edited.
- Actual ChatGPT → bundled Jarvis sidecar → `desktop_read` → bundled native helpers returned
  the exact fixture field text. Auth used the existing sign-in; test history/settings were isolated.
- Full sidecar suite: 122 tests plus existing MJS checks and typecheck; the opt-in Docker test
  is skipped in the ordinary suite. Native Rust suite: 10 tests.
- Lock-screen/other-Space policy is implemented but was **not** tested by locking the user's
  active Mac or moving their windows. Notes/Finder and physical-input fallback are not yet
  validated. The installed production app remains unchanged; native Preview is the test bundle.

The integration borrows scope/ownership/failure-handling principles from PacoBot's
`server/desktop-link/agent-desktop-driver.ts`, but does not depend on the PacoBot service.

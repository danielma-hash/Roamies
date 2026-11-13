import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VOICE } from '../fish.mjs';

// Every look the app offers has a drawing and its voice; the setup guide offers the same looks.
const src = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const side = src('../sidekick.mjs'), guide = src('../../../onboarding/onboarding.js');
const looks = [...side.slice(side.indexOf('const LOOKS = ['), side.indexOf('];', side.indexOf('const LOOKS = ['))).matchAll(/\['(\w+)', '([^']+)', (DEFAULT_VOICE|'(\w+)')\]/g)];
assert.deepEqual(looks.map((m) => m[1]), ['classic', 'jarvis', 'anime', 'sarah', 'adrian']);
const voices = Object.fromEntries(looks.map((m) => [m[1], m[4] ?? null]));
assert.equal(voices.classic, null, 'Roamie uses DEFAULT_VOICE');
assert.equal(DEFAULT_VOICE, '2680da81de8348a68e1f4dbaa79272f1');
assert.equal(voices.jarvis, 'e13fa398a7f445a685316a3de6089ce7');
// Regression: Roamie spoke with JARVIS's voice (the default was JARVIS's ID).
assert.equal(new Set([DEFAULT_VOICE, ...Object.values(voices).filter(Boolean)]).size, 5, 'every look has its own voice');
assert.ok(!/config\.fishVoice/.test(side), 'a saved fishVoice (the old JARVIS default) is never used');
assert.equal(voices.anime, 'd8f3b4c1199f4568a767ec54112d2b17');
assert.equal(voices.sarah, '933563129e564b19a115bedd57b7406a');
assert.equal(voices.adrian, 'bf322df2096a46f18c579d0baa36f41d');
for (const [, id, label] of looks) assert.ok(guide.includes(`['${id}', '${label}']`), `the setup guide offers ${label}`);

// The characters draw at every size without throwing, inside their area, and the sprites are well formed.
const warns = [];
globalThis.window = { Roamie: {} };
const warn = console.warn; console.warn = (m) => warns.push(m);
new Function(src('../../../roamies/people.js'))();
console.warn = warn;
assert.deepEqual(warns, [], 'every sprite row is half or whole width');
const P = window.Roamie.people;
const th = () => 0.5;
// ken: Ken Kai, on the About page (drawn the same way, though not a look you can pick).
for (const who of ['anime', 'sarah', 'adrian', 'ken']) for (const size of ['default', 'small', 'cursor']) for (const state of [{}, { mode: 'talk', voice: 0.9 }, { happy: 1 }, { open: 0 }, { dizzy: 1 }, { sleepy: 1 }, { act: 'hype', actA: 0.2 }, { act: 'upset', actA: 0.1 }]) {
  const cells = [];
  const k = { put: (x, y, l) => { assert.ok(Number.isInteger(x) && Number.isInteger(y) && l >= 0 && l <= 4, `${who} ${size} cell`); cells.push([x, y]); }, L: 4, th };
  const st = { t: 1, mode: null, voice: null, act: null, actA: 0, open: 1, look: [0.5, -0.3], vx: 0, sq: 0, wide: 0, dizzy: 0, happy: 0, sleepy: 0, mouth: null, brow: null, ...state };
  if (size === 'cursor') P[who].cursor(k, 50, 50, 46, 43, st); else P[who].body(k, 50, 50, size === 'small' ? 6.4 : 12.75, st);
  assert.ok(cells.length > 40, `${who} ${size} draws`);
  const span = Math.max(...cells.map(([x]) => x)) - Math.min(...cells.map(([x]) => x));
  assert.ok(span < (size === 'default' ? 40 : 24), `${who} ${size} stays its size (${span})`);
}
assert.ok(!looks.some((m) => m[1] === 'ken'), 'Ken is not a pickable look');
console.log('looks tests: passed');

// Jarvis uses continuous paths, keeps fractional screen coordinates, and paints a repeatable pose.
function vectorContext() {
  const calls = [], saved = [];
  const ctx = { calls, globalAlpha: 1,
    save() { saved.push(this.globalAlpha); }, restore() { this.globalAlpha = saved.pop(); },
    createRadialGradient(...args) { calls.push(['gradient', ...args]); return { addColorStop: (...stop) => calls.push(['stop', ...stop]) }; },
    stroke() { calls.push(['stroke', this.strokeStyle, this.lineWidth, this.globalAlpha]); },
    fill() { calls.push(['fill', this.globalAlpha]); },
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() {}, drawImage() {}, clearRect() {}, setTransform() {},
  };
  for (const name of ['translate', 'scale', 'rotate', 'beginPath', 'arc', 'ellipse', 'moveTo', 'lineTo', 'fillRect']) ctx[name] = (...args) => {
    assert.ok(args.every(Number.isFinite), `${name} receives finite geometry`);
    if (name === 'arc') assert.ok(args[2] >= 0);
    if (name === 'ellipse') assert.ok(args[2] >= 0 && args[3] >= 0);
    calls.push([name, ...args]);
  };
  return ctx;
}
new Function(src('../../../roamies/jarvis.js'))();
const jarvis = window.Roamie.jarvis;
const base = { t: 1, spin: 0.2, mode: null, open: 1, look: [0.2, -0.3], sleepy: 0 };
for (const radius of [12, 26, 51, 140]) for (const cursor of [false, true]) for (const mode of [null, 'listen', 'think', 'talk']) {
  const ctx = vectorContext(), state = { ...base, mode };
  jarvis.draw(ctx, 80.25, 90.75, radius, state, cursor, 64.25, 62.75);
  assert.deepEqual(ctx.calls[0], ['translate', 80.25, 90.75], 'no LED-grid snapping');
  assert.ok(ctx.calls.filter(([name]) => name === 'arc' || name === 'ellipse').length >= 6);
  assert.ok(!ctx.calls.some(([name]) => name === 'fillRect'), 'body is drawn with curves, not cells');
  assert.ok(ctx.calls.length < 90, 'path work stays bounded at every size');
  assert.equal(state.spin, base.spin, 'drawing never advances animation time');
}
for (const preference of ['reduced', 'quiet']) {
  const first = vectorContext(), later = vectorContext();
  jarvis.draw(first, 50, 50, 26, { ...base, [preference]: true, mode: 'talk', voice: 0 });
  jarvis.draw(later, 50, 50, 26, { ...base, [preference]: true, mode: 'talk', t: 100, spin: 99, open: 0, voice: 1 });
  assert.deepEqual(first.calls, later.calls, `${preference} stops ambient motion and voice pulsing`);
}
const faded = vectorContext(); faded.globalAlpha = 0.25;
jarvis.draw(faded, 50, 50, 26, base);
assert.ok(faded.calls.filter(([name]) => name === 'fill' || name === 'stroke').every((call) => call.at(-1) <= 0.25), 'presence fading applies to every layer');

// Exercise the actual sidekick renderer: bounded patch, native sprite capture, and switching looks.
globalThis.matchMedia = () => ({ matches: false });
globalThis.addEventListener = () => {};
globalThis.document = { addEventListener() {}, createElement: () => ({ getContext: () => vectorContext(), toDataURL: () => 'data:image/png;base64,AA==' }) };
new Function(src('../../../roamies/core.js'))();
globalThis.Roamie = window.Roamie;
new Function(src('../../../roamies/jarvis.js'))();
new Function(src('../../../roamies/10-dither.js'))();
new Function(src('../../../roamies/12-sidekick.js'))();
const env = { w: 400, h: 400, dpr: 2, unit: 340, transparent: true, sleepy: 0, reduced: false,
  spawn: { x: 200.25, y: 200.75 }, mouse: { x: 0, y: 0, active: false, inside: false } };
let spriteKit;
Roamie.agentPlugin = (kit) => { spriteKit = kit; return null; };
const sidekick = Roamie.types.find(({ id }) => id === 'sidekick').create(env);
sidekick.resize(env); sidekick.setLook('jarvis');
for (const form of ['default', 'small', 'cursor']) {
  sidekick.setForm(form);
  sidekick.update(0.016, env);
  const patch = sidekick.prepare(env), ctx = vectorContext();
  assert.ok(patch && patch.x0 < sidekick.mover.x && patch.x1 > sidekick.mover.x, `${form} reserves the vector body`);
  assert.ok(Number.isNaN(patch.sig), 'vector motion is not skipped by the LED fingerprint');
  sidekick.draw(ctx, env);
  assert.ok(ctx.calls.some(([name]) => name === 'arc'), `${form} reaches the smooth renderer`);
  const sprite = spriteKit.sprite();
  assert.ok(sprite?.open && sprite?.shut && sprite.w > 0 && sprite.h > 0, `${form} still exports the native follower sprite`);
}
sidekick.setCompanionMode('quiet'); sidekick.update(0.016, env); sidekick.prepare(env); sidekick.draw(vectorContext(), env);
sidekick.setLook('classic'); sidekick.prepare(env);
const classic = vectorContext(); sidekick.draw(classic, env);
assert.ok(!classic.calls.some(([name]) => name === 'arc'), 'classic keeps its own LED renderer');
delete globalThis.document; delete globalThis.matchMedia; delete globalThis.addEventListener; delete globalThis.Roamie;
console.log('smooth Jarvis tests: passed');

// Regression: a selected stage canvas showed as a grey box around the Roamie (WebKit tints selected canvases).
assert.match(src('../../../desktop.html'), /canvas \{[^}]*-webkit-user-select: none; user-select: none;[^}]*\}/);

// Regression: after a drawing the Sidekick stopped following the cursor and hopped away from it instead.
{
  const agent = src('../../../roamies/agent.js'), rel = agent.slice(agent.indexOf('async release()'), agent.indexOf('place: (x, y) =>'));
  assert.match(agent, /pen\.follow = !!station\.byCursor/, 'take() remembers whether it was following the cursor');
  assert.match(rel, /if \(pen\.follow && presence\.ptr\) station\.byCursor = presence\.ptr\.slice\(\)/, 'release() goes back to following');
}

// The bubbles, tags and step list draw with glass.js, so the overlay loads it before them.
{
  const page = src('../../../desktop.html'), at = (f) => page.indexOf(`roamies/${f}`);
  assert.ok(at('glass.js') > 0 && at('glass.js') < at('agent.js') && at('glass.js') < at('agent-cards.js'), 'desktop.html loads glass.js before agent.js and agent-cards.js');
}

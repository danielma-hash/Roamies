import { expect, it, vi } from 'vitest';
import { DesktopDriverService } from '../desktop-driver.service.js';
import { createDesktopTools } from '../desktop-tools.js';
// @ts-expect-error Existing app safety module is JavaScript.
import { checkDesktopAction, SAFE, ASK, BLOCK } from '../safety.mjs';
import type { DesktopPolicy } from '../desktop-driver.types.js';
const policy: DesktopPolicy = { windowId: 7, pid: 123, bundle: 'com.apple.TextEdit', app: 'TextEdit', instance: '123:1', title: 'fixture', protected: false, trusted: true };
const field = { ref_id: '@sfixture:e1', role: 'textfield', value: 'before', available_actions: ['SetValue'], states: [] };
it('serializes tool results using the actual gg-agent string-result contract', async () => {
  const s = setup(); const tool = createDesktopTools(s.driver)[0];
  const result = await tool.execute({ windowId: 7 });
  expect(typeof result).toBe('string'); expect(JSON.parse(result)).toMatchObject({ windowId: 7, untrustedContent: true });
});
function setup() {
  let now = 1000; let owner = policy; let visible = true; let value = 'before'; let snapshotWindow = 'w-7'; let clicked = false;
  const confirm = vi.fn(async () => true);
  const run = vi.fn(async (args: readonly string[], text?: string): Promise<unknown> => {
    if (args[0] === 'list-windows') return { version: '2.6', ok: true, data: [{ id: 'w-7', pid: 123, visible, process_instance: 'p1' }] };
    if (args[0] === 'snapshot') return { version: '2.6', ok: true, data: { window: { id: snapshotWindow }, snapshot_id: 'sfixture', tree: { role: 'window', children: [{ ...field, value }, { role: 'button', name: 'Delete', available_actions: ['Click'], ref_id: '@sfixture:e2' }, { role: 'securetextfield', value: 'hidden-secret', children: [{ role: 'text', value: 'hidden-child' }] }] } } };
    if (args[0] === 'set-value') value = text ?? ''; if (args[0] === 'click') clicked = true;
    return { version: '2.6', ok: true, data: {} };
  });
  const options = { run, policy: async () => owner, allowActions: () => true, confirm, now: () => now };
  return { run, options, driver: new DesktopDriverService(options), confirm, setOwner: (next: DesktopPolicy) => { owner = next; }, hide: () => { visible = false; }, advance: () => { now += 60_001; }, wrongWindow: () => { snapshotWindow = 'w-8'; }, clicked: () => clicked };
}
it('reads bounded text and fills by a scoped ref, then observes actual current content', async () => {
  const s = setup(); const read = await s.driver.read(7); expect(read.elements).toHaveLength(3); expect(JSON.stringify(read)).not.toContain('hidden-');
  expect(s.run.mock.calls.filter(([args]) => ['list-windows', 'snapshot'].includes(args[0])).every(([args]) => args.includes('--app') && args.includes('TextEdit'))).toBe(true);
  const result = await s.driver.act({ ref: '@sfixture:e1', action: 'fill', text: 'שלום Jarvis' });
  expect(result).toMatchObject({ status: 'observed', verified: false, snapshot: { elements: [expect.anything(), expect.objectContaining({ value: 'שלום Jarvis' }), expect.anything()] } });
  const call = s.run.mock.calls.find(([args]) => args[0] === 'set-value')!;
  expect(call[0]).toContain('--stdin'); expect(call[0]).not.toContain('שלום Jarvis'); expect(call[1]).toBe('שלום Jarvis');
});
it('rejects invented, expired, changed-owner and hidden-window refs before delivery', async () => {
  const s = setup(); await expect(s.driver.act({ ref: '@sother:e1', action: 'click' })).rejects.toThrow();
  await s.driver.read(7); s.advance(); await expect(s.driver.act({ ref: '@sfixture:e1', action: 'fill', text: 'x' })).rejects.toThrow('ישנה');
  await s.driver.read(7); s.setOwner({ ...policy, instance: '123:2' }); await expect(s.driver.act({ ref: '@sfixture:e1', action: 'fill', text: 'x' })).rejects.toThrow('הבעלות');
  s.hide(); await expect(s.driver.read(7)).rejects.toThrow('גלוי');
  expect(s.run.mock.calls.some(([args]) => ['click', 'set-value'].includes(args[0]))).toBe(false);
});
it('refuses protected apps, missing accessibility, wrong snapshot window and incompatible envelopes', async () => {
  const s = setup(); s.setOwner({ ...policy, protected: true }); await expect(s.driver.read(7)).rejects.toThrow('מוגנת');
  s.setOwner({ ...policy, trusted: false }); await expect(s.driver.read(7)).rejects.toThrow('נגישות');
  s.setOwner(policy); s.wrongWindow(); await expect(s.driver.read(7)).rejects.toThrow();
  const bad = new DesktopDriverService({ ...s.options, run: async () => ({ version: '3.0', ok: true, data: [] }) }); await expect(bad.read(7)).rejects.toThrow();
});
it('consumes refs before an unknown delivery and never retries or falls back', async () => {
  const s = setup(); const run = async (args: readonly string[], text?: string) => {
    if (args[0] === 'set-value') throw new Error('timeout'); return s.run(args, text);
  };
  const wrapped = vi.fn(run); const driver = new DesktopDriverService({ ...s.options, run: wrapped });
  await driver.read(7); expect(await driver.act({ ref: '@sfixture:e1', action: 'fill', text: 'x' })).toMatchObject({ status: 'unknown', verified: false });
  await expect(driver.act({ ref: '@sfixture:e1', action: 'fill', text: 'x' })).rejects.toThrow('ההפניה');
  expect(wrapped.mock.calls.filter(([args]) => args[0] === 'set-value')).toHaveLength(1);
});
it('asks for a risky click and rechecks settings/ownership after approval', async () => {
  const s = setup(); await s.driver.read(7); s.confirm.mockImplementation(async () => { s.setOwner({ ...policy, title: 'another document' }); return true; });
  await expect(s.driver.act({ ref: '@sfixture:e2', action: 'click' })).rejects.toThrow('הבעלות'); expect(s.clicked()).toBe(false);
  expect(s.confirm).toHaveBeenCalledOnce();
  const blocked = new DesktopDriverService({ ...s.options, allowActions: () => false }); await blocked.read(7);
  await expect(blocked.act({ ref: '@sfixture:e2', action: 'click' })).rejects.toThrow('כבויות'); expect(s.clicked()).toBe(false);
});
it('prevents simultaneous writes or reads from replacing the pending action refs', async () => {
  const s = setup(); let release!: (value: boolean) => void;
  s.confirm.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  await s.driver.read(7); const pending = s.driver.act({ ref: '@sfixture:e2', action: 'click' });
  await vi.waitFor(() => expect(release).toBeDefined());
  await expect(s.driver.read(7)).rejects.toThrow('כבר'); await expect(s.driver.act({ ref: '@sfixture:e1', action: 'fill', text: 'x' })).rejects.toThrow('כבר');
  release(false); expect(await pending).toMatchObject({ status: 'cancelled' }); expect(s.clicked()).toBe(false);
});
it('enforces the shared safety gate for unsupported/disabled/secure elements', () => {
  const element = { role: 'textfield', name: 'name', actions: ['SetValue'], states: [] };
  expect(checkDesktopAction('fill', policy, { allowActions: true, element, text: '' }).level).toBe(SAFE);
  expect(checkDesktopAction('fill', policy, { allowActions: false, element, text: 'x' }).level).toBe(BLOCK);
  expect(checkDesktopAction('fill', policy, { allowActions: true, element: { ...element, role: 'securetextfield' }, text: 'x' }).level).toBe(BLOCK);
  expect(checkDesktopAction('click', policy, { allowActions: true, element: { ...element, actions: ['Click'], states: ['disabled'] } }).level).toBe(BLOCK);
  expect(checkDesktopAction('click', policy, { allowActions: true, element: { ...element, name: 'Delete', actions: ['Click'] } }).level).toBe(ASK);
  expect(checkDesktopAction('click', policy, { allowActions: true, element: { ...element, name: 'שליחת מסמך', actions: ['Click'] } }).level).toBe(ASK);
});

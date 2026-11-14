import { expect, it } from 'vitest';
import { SessionViewStore } from '../session-view-store.js';
const id = '12345678-1234-4567-8901-123456789abc';
const storage = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; };
it('restores selection, Hebrew query and unsent drafts across fresh instances', () => {
  const disk = storage(); const first = new SessionViewStore(disk);
  first.update({ selected: id, filter: 'interrupted', query: 'סקירה' }); first.set(id, 'Jarvis המשך מכאן');
  first.set('new.cwd', '/tmp/project'); first.set('new.instruction', 'פתח בדיקה');
  const restored = new SessionViewStore(disk);
  expect(restored.snapshot()).toEqual(expect.objectContaining({ selected: id, filter: 'interrupted', query: 'סקירה' }));
  expect(restored.get(id)).toBe('Jarvis המשך מכאן'); expect(restored.get('new.instruction')).toBe('פתח בדיקה');
  restored.clearDrafts(); expect(new SessionViewStore(disk).get(id)).toBeUndefined(); expect(restored.snapshot().selected).toBe(id);
});
it('rejects invalid versions without clobbering the stored value on read', () => {
  const disk = storage(); disk.setItem('jarvis.session-center.v1', '{"version":2}');
  const view = new SessionViewStore(disk); expect(view.error()).toContain('לא ניתן לשחזר');
  expect(disk.getItem('jarvis.session-center.v1')).toBe('{"version":2}');
});
it('keeps the draft in memory and reports quota failures instead of claiming persistence', () => {
  const view = new SessionViewStore({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
  view.set(id, 'חשוב'); expect(view.get(id)).toBe('חשוב'); expect(view.error()).toContain('שמירת התצוגה נכשלה');
});
it('bounds draft retention and rejects arbitrary storage keys', () => {
  const view = new SessionViewStore(storage());
  for (let n = 0; n < 60; n++) view.set(`${n.toString(16).padStart(8, '0')}-1234-4567-8901-123456789abc`, 'x'.repeat(13_000));
  view.set('__proto__', 'bad'); expect(view.snapshot().drafts).toHaveLength(50);
  expect(view.snapshot().drafts.every(([, text]) => text.length === 12_000)).toBe(true);
});

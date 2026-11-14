import { expect, it } from 'vitest';
import { sessionAction, sessionRows } from '../session-center.model.js';
import type { SessionCenterSnapshot } from '../session-center.types.js';

const snapshot: SessionCenterSnapshot = {
  observedAt: 200, actions: true,
  sessions: [{ id: 'owned', title: 'old title', cwd: '/tmp/project', branch: '', updatedAt: 500, status: 'running' },
    { id: 'external', title: 'סקירת קוד', cwd: '/tmp/Other', branch: 'main', updatedAt: 50, status: 'unknown' }],
  runs: [{ id: 'owned', title: 'התקדמות שמורה', cwd: '/tmp/Project', state: 'interrupted', queued: 0, lastReply: '', updatedAt: 100 },
    { id: 'waiting', title: 'אישור', cwd: '/tmp/work', state: 'waiting', queued: 1, lastReply: '', updatedAt: 150 }],
};
it('uses owned process evidence rather than stale history for the same session', () => {
  expect(sessionRows(snapshot, 'all', '').map(({ id }) => id)).toEqual(['waiting', 'owned', 'external']);
  expect(sessionRows(snapshot, 'active', '')).toEqual([]);
  expect(sessionRows(snapshot, 'interrupted', '')).toEqual([expect.objectContaining({ id: 'owned', title: 'התקדמות שמורה' })]);
  expect(sessionRows(snapshot, 'attention', '').map(({ id }) => id)).toEqual(['waiting']);
  expect(sessionRows(snapshot, 'history', '').map(({ id }) => id)).toEqual(['external']);
});
it('searches Hebrew titles and case insensitive project paths without changing input', () => {
  expect(sessionRows(snapshot, 'all', 'סקירת')[0]?.id).toBe('external');
  expect(sessionRows(snapshot, 'all', 'PROJECT')[0]?.id).toBe('owned');
  expect(snapshot.sessions[0]?.title).toBe('old title');
});
it('requires explicit resume for recovered or externally owned history', () => {
  const rows = sessionRows(snapshot, 'all', '');
  expect(rows.map(sessionAction)).toEqual(['claude_control_send', 'claude_control_resume', 'claude_control_resume']);
});

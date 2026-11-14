import type { SessionCenterRow, SessionCenterSnapshot, SessionFilter } from './session-center.types.js';

export const SESSION_LABELS: Readonly<Record<SessionCenterRow['state'], string>> = {
  starting: 'מתחבר', running: 'עובד כעת', waiting: 'ממתין לאישור', idle: 'מוכן להמשך',
  stopped: 'נעצר', failed: 'ההרצה נכשלה', interrupted: 'התקדמות שמורה', ended: 'הסתיים', unknown: 'מצב חי לא ידוע',
};
export function sessionRows(snapshot: SessionCenterSnapshot, filter: SessionFilter, query: string): readonly SessionCenterRow[] {
  const rows = new Map<string, SessionCenterRow>();
  for (const session of snapshot.sessions) rows.set(session.id, { ...session, state: session.status, managed: false });
  for (const run of snapshot.runs) rows.set(run.id, { ...run, updatedAt: run.updatedAt ?? 0, managed: true, run });
  const match = query.normalize('NFC').toLocaleLowerCase().trim();
  return [...rows.values()].filter((row) => {
    if (filter === 'active' && !['starting', 'running'].includes(row.state)) return false;
    if (filter === 'attention' && !['waiting', 'failed'].includes(row.state)) return false;
    if (filter === 'interrupted' && row.state !== 'interrupted') return false;
    if (filter === 'history' && row.managed) return false;
    return !match || `${row.title} ${row.cwd}`.normalize('NFC').toLocaleLowerCase().includes(match);
  }).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}
export function sessionAction(row: SessionCenterRow): 'claude_control_send' | 'claude_control_resume' {
  return row.managed && ['starting', 'running', 'waiting', 'idle'].includes(row.state) ? 'claude_control_send' : 'claude_control_resume';
}

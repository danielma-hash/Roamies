import type { TaskCard } from './task-cards.service.js';
import type { AttentionEvent, AttentionSnapshot } from './attention.types.js';

export interface OperationsWorkspaceState {
  readonly cards: readonly TaskCard[];
  readonly attention?: AttentionSnapshot;
  readonly error?: string;
  readonly busy?: boolean;
}

export type OperationsWorkspaceAction =
  | { readonly type: 'workspace'; readonly action: 'tasks.add'; readonly url: string; readonly monday?: string }
  | { readonly type: 'workspace'; readonly action: 'tasks.refresh'; readonly url: string }
  | { readonly type: 'workspace'; readonly action: 'attention.preferences'; readonly quiet: boolean; readonly focus: boolean }
  | { readonly type: 'workspace'; readonly action: 'attention.dismiss'; readonly id: string };

const CHECKS: Readonly<Record<string, string>> = {
  SUCCESS: 'עברה', FAILURE: 'נכשלה', ERROR: 'שגיאה', PENDING: 'ממתינה', QUEUED: 'בתור',
  IN_PROGRESS: 'פועלת', REQUESTED: 'התבקשה', WAITING: 'ממתינה', COMPLETED: 'הסתיימה ללא תוצאה זמינה',
  CANCELLED: 'בוטלה', TIMED_OUT: 'חרגה מהזמן', ACTION_REQUIRED: 'נדרשת פעולה',
  NEUTRAL: 'ניטרלית', SKIPPED: 'דולגה', STARTUP_FAILURE: 'כשלה בהפעלה',
};
const EVENTS: Readonly<Record<AttentionEvent['kind'], string>> = {
  'session-waiting': 'שיחה ממתינה לך', 'session-ended': 'שיחה הסתיימה',
  'checks-failed': 'בדיקות נכשלו', 'checks-passed': 'בדיקות עברו',
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label: string, onClick: () => void, disabled: boolean): HTMLButtonElement {
  const node = element('button', 'workspace-button', label); node.type = 'button'; node.disabled = disabled;
  node.addEventListener('click', onClick); return node;
}
function link(label: string, url: string, kind: 'github' | 'monday'): HTMLElement {
  const valid = kind === 'github' ? /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9][0-9]*\/?$/.test(url)
    : /^https:\/\/[a-z0-9-]+\.monday\.com\/boards\/\d+\/pulses\/\d+\/?$/i.test(url);
  if (!valid) return element('span', 'workspace-note', `${label}: קישור לא זמין`);
  const node = element('a', 'workspace-button', label); node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer';
  return node;
}

/** Local workspace controls. Network operations are requested through the existing host bridge. */
export function renderOperationsWorkspace(state: OperationsWorkspaceState, send: (message: OperationsWorkspaceAction) => void): HTMLElement {
  const root = element('section', 'workspace'); root.dir = 'rtl'; root.lang = 'he';
  root.setAttribute('aria-label', 'משימות ועדכונים'); root.setAttribute('aria-busy', String(Boolean(state.busy)));
  root.append(element('h2', 'workspace-title', 'משימות ועדכונים'));
  const form = element('form', 'workspace-search');
  const prLabel = element('label', 'workspace-search-label', 'קישור ל־PR ב־GitHub');
  const pr = element('input', 'workspace-search-input'); pr.type = 'url'; pr.dir = 'ltr'; pr.required = true; pr.maxLength = 1000;
  pr.placeholder = 'https://github.com/org/repo/pull/123'; pr.disabled = Boolean(state.busy); prLabel.append(pr);
  const mondayLabel = element('label', 'workspace-search-label', 'קישור למשימה ב־Monday — לא חובה');
  const monday = element('input', 'workspace-search-input'); monday.type = 'url'; monday.dir = 'ltr'; monday.maxLength = 1000;
  monday.placeholder = 'https://company.monday.com/boards/…/pulses/…'; monday.disabled = Boolean(state.busy); mondayLabel.append(monday);
  const add = element('button', 'workspace-button', state.busy ? 'טוען…' : 'הוספת PR למעקב'); add.type = 'submit'; add.disabled = Boolean(state.busy);
  form.append(prLabel, mondayLabel, add);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state.busy && pr.value.trim()) send({ type: 'workspace', action: 'tasks.add', url: pr.value.trim(), ...(monday.value.trim() ? { monday: monday.value.trim() } : {}) });
  });
  root.append(form);
  if (state.error) {
    const error = element('p', 'workspace-feedback', state.error); error.setAttribute('role', 'alert'); root.append(error);
  }
  const cards = element('div', 'workspace-sessions'); cards.setAttribute('role', 'list'); cards.setAttribute('aria-label', 'PRs במעקב');
  if (!state.cards.length && !state.busy) cards.append(element('p', 'workspace-empty', 'אפשר להוסיף PR כדי לראות branch, בדיקות וקישור למשימה.'));
  for (const task of state.cards) {
    const card = element('article', 'workspace-session'); card.setAttribute('role', 'listitem');
    const title = element('h3', 'workspace-session-title', task.title); title.dir = 'auto'; title.dataset.userContent = '';
    const status = { OPEN: 'פתוח', CLOSED: 'סגור', MERGED: 'מוזג' }[task.state] || 'לא ידוע';
    const branch = element('p', 'workspace-session-branch', `branch: ${task.headRefName}`); branch.dir = 'auto'; branch.dataset.userContent = '';
    const sha = element('p', 'workspace-session-branch', `SHA: ${task.headRefOid}`); sha.dir = 'ltr'; sha.dataset.userContent = '';
    card.append(title, element('span', 'workspace-session-status', `PR: ${status}`), branch, sha,
      element('p', 'workspace-note', 'פריסה: לא ידוע'));
    const checks = element('ul', 'workspace-checks'); checks.setAttribute('aria-label', 'בדיקות GitHub');
    if (!task.statusCheckRollup?.length) checks.append(element('li', 'workspace-note', 'אין נתוני בדיקות זמינים.'));
    for (const check of task.statusCheckRollup ?? []) {
      const result = (check.conclusion || check.state || check.status || '').toUpperCase();
      const item = element('li', 'workspace-note');
      const name = element('bdi', '', check.name || 'בדיקה'); name.dataset.userContent = '';
      item.append(name, document.createTextNode(`: ${CHECKS[result] || 'מצב לא ידוע'}`)); checks.append(item);
    }
    card.append(checks);
    const actions = element('div', 'workspace-actions');
    actions.append(link('פתיחה ב־GitHub', task.url, 'github'));
    if (task.monday) actions.append(link('פתיחה ב־Monday', task.monday, 'monday'));
    actions.append(button('רענון בדיקות', () => send({ type: 'workspace', action: 'tasks.refresh', url: task.url }), Boolean(state.busy)));
    const timestamp = Number.isFinite(task.observedAt) ? new Date(task.observedAt).toLocaleString('he-IL') : 'לא ידוע';
    card.append(element('p', 'workspace-session-updated', `נבדק: ${timestamp}`), actions); cards.append(card);
  }
  root.append(cards);

  const attention = element('section', 'workspace-detail'); attention.setAttribute('aria-label', 'התראות');
  attention.append(element('h3', 'workspace-detail-title', `התראות${state.attention ? ` (${state.attention.unread})` : ''}`));
  const controls = element('div', 'workspace-actions');
  const quietLabel = element('label', 'workspace-filter'); const quiet = element('input', 'workspace-filter-input');
  quiet.type = 'checkbox'; quiet.checked = state.attention?.preferences.quiet ?? false;
  quiet.disabled = !state.attention || Boolean(state.busy); quietLabel.append(quiet, document.createTextNode('מצב שקט'));
  const focusLabel = element('label', 'workspace-filter'); const focus = element('input', 'workspace-filter-input');
  focus.type = 'checkbox'; focus.checked = state.attention?.preferences.focus ?? false;
  focus.disabled = !state.attention || Boolean(state.busy); focusLabel.append(focus, document.createTextNode('מצב מיקוד'));
  const preferences = (): void => {
    if (!state.busy && state.attention) send({ type: 'workspace', action: 'attention.preferences', quiet: quiet.checked, focus: focus.checked });
  };
  quiet.addEventListener('change', preferences); focus.addEventListener('change', preferences);
  controls.append(quietLabel, focusLabel); attention.append(controls,
    element('p', 'workspace-note', 'בשקט או במיקוד, העדכונים נשמרים כאן בלי להפריע.'));
  const unread = state.attention?.events.filter((event) => event.dismissedAt === undefined).slice().reverse() ?? [];
  if (!state.attention) attention.append(element('p', 'workspace-empty', 'ההתראות עדיין לא נטענו.'));
  else if (!unread.length) attention.append(element('p', 'workspace-empty', 'אין עדכונים שממתינים לטיפול.'));
  for (const event of unread) {
    const item = element('article', 'workspace-message');
    const title = element('p', 'workspace-message-text', event.title); title.dir = 'auto'; title.dataset.userContent = '';
    item.append(element('h4', 'workspace-message-role', EVENTS[event.kind]), title,
      button('סימון כנקרא', () => send({ type: 'workspace', action: 'attention.dismiss', id: event.id }), Boolean(state.busy)));
    if (event.url) item.append(link('פתיחת PR', event.url, 'github'));
    attention.append(item);
  }
  root.append(attention); return root;
}

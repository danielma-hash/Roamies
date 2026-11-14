import { PanelViewStateService } from './panel-view-state.service.js';
import { PanelLibraryView } from './browser-panel-library.js';
import { LivePanelView } from './browser-live-panel.js';
import { renderClaudeControl, renderClaudeInstruction } from './browser-claude-control.js';
import type { ClaudeControlAction } from './browser-claude-control.js';
import { sessionAction, sessionRows, SESSION_LABELS } from './session-center.model.js';
import type { SessionCenterSnapshot, SessionFilter } from './session-center.types.js';
import { SessionViewStore } from './session-view-store.js';

type Request = ClaudeControlAction | { readonly type: 'workspace'; readonly action: 'sessions.list'; readonly query: string };
type Invoke = (command: string, args: { readonly msg: unknown }) => Promise<unknown>;
declare global { interface Window { __sessionCenter?: (message: unknown) => void; __TAURI__?: { readonly core?: { readonly invoke?: Invoke } }; } }
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag); el.textContent = text; el.className = className; return el;
};
const button = (text: string, action: () => void): HTMLButtonElement => {
  const el = node('button', text); el.type = 'button'; el.addEventListener('click', action); return el;
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';

/** Trusted catalog UI only: all session text uses textContent, never model HTML or code. */
export class SessionCenterView {
  private state: SessionCenterSnapshot = { runs: [], sessions: [], observedAt: 0, actions: false };
  private selected?: string;
  private filter: SessionFilter = 'all';
  private detailKey = '';
  private readonly list = node('nav', '', 'session-list');
  private readonly detail = node('section', '', 'session-detail');
  private readonly search = node('input');
  private readonly freshness = node('p', 'מתחבר למרכז העבודה…', 'freshness');
  private readonly notice = node('p', '', 'notice');
  private readonly approval = node('section', '', 'approval');
  private approvalId?: string;
  private readonly counts = node('div', '', 'metrics');
  private readonly filters = node('div', '', 'filters');
  private readonly pending = new Set<string>();
  private readonly requests = new Map<string, string>();

  constructor(private readonly root: HTMLElement, private readonly invoke: Invoke, private readonly store: SessionViewStore) {
    const saved = store.snapshot(); this.selected = saved.selected; this.filter = saved.filter; this.search.value = saved.query;
    const header = node('header'); const brand = node('div');
    brand.append(node('p', 'JARVIS / מרחב העבודה', 'eyebrow'), node('h1', 'כל העבודה, במקום אחד'), this.freshness);
    const actions = node('div', '', 'header-actions');
    actions.append(button('סשן חדש', () => { this.selected = 'new'; this.persistView(); this.renderDetail(); }), button('רענון', () => { void this.send({ type: 'workspace', action: 'sessions.list', query: '' }); }));
    header.append(brand, actions); this.notice.setAttribute('role', 'status');
    this.list.setAttribute('aria-label', 'סשנים'); this.detail.setAttribute('aria-label', 'פרטי הסשן');
    this.search.type = 'search'; this.search.placeholder = 'חיפוש לפי שיחה או פרויקט'; this.search.maxLength = 200;
    this.search.setAttribute('aria-label', 'חיפוש סשנים'); this.search.dir = 'auto';
    this.search.addEventListener('input', () => { this.persistView(); this.renderList(); });
    root.addEventListener('input', () => { const error = this.store.error(); if (error) this.notice.textContent = error; });
    const sidebar = node('aside'); sidebar.append(this.search, this.filters, this.list);
    const layout = node('div', '', 'session-layout'); layout.append(sidebar, this.detail);
    this.approval.hidden = true; this.approval.setAttribute('aria-label', 'אישור פעולה'); this.approval.setAttribute('role', 'region');
    root.append(header, this.approval, this.counts, this.notice, layout);
    for (const [id, title] of [['all', 'הכול'], ['active', 'עובדים'], ['attention', 'דורשים תשומת לב'], ['interrupted', 'להמשך'], ['history', 'היסטוריה']] as const) {
      const el = button(title, () => { this.filter = id; this.persistView(); this.renderList(); }); el.dataset.filter = id; this.filters.append(el);
    }
    let clearing = false;
    const clear = button('ניקוי טיוטות מקומיות', () => {
      if (!clearing) { clearing = true; clear.textContent = 'לחץ שוב למחיקת הטיוטות'; return; }
      this.store.clearDrafts(); this.detailKey = ''; this.renderDetail(); clearing = false; clear.textContent = 'ניקוי טיוטות מקומיות';
      this.notice.textContent = this.store.error() ?? 'הטיוטות נמחקו. ההיסטוריה וההתקדמות נשמרו.';
    });
    sidebar.append(node('p', 'התצוגה ו־50 הטיוטות האחרונות נשמרות במק. הן לא נשלחות עד לבחירת פעולה.', 'freshness'), clear);
    this.renderList(); this.renderDetail();
  }

  receive(message: unknown): void {
    if (!record(message)) return;
    if (message.kind === 'state' && record(message.snapshot) && Array.isArray(message.snapshot.runs) && Array.isArray(message.snapshot.sessions)) {
      // Payload originates in the local sidecar. Native bridge projects it before delivery.
      this.state = message.snapshot as unknown as SessionCenterSnapshot;
      this.renderApproval();
      this.freshness.textContent = this.state.observedAt ? `החיבור עודכן ב־${new Date(this.state.observedAt).toLocaleTimeString('he-IL')}` : 'ממתין לתצפית ראשונה';
      this.notice.textContent = this.store.error() ?? this.state.error ?? (!this.state.actions ? 'צפייה זמינה. להפעלת סשנים יש להפעיל פעולות בהגדרות.' : '');
      this.counts.replaceChildren(...(['active', 'attention', 'interrupted'] as const).map((filter) => {
        const label = { active: 'עובדים כעת', attention: 'מחכים לתשומת לב', interrupted: 'התקדמות שמורה' }[filter];
        const el = button(`${sessionRows(this.state, filter, '').length} ${label}`, () => { this.filter = filter; this.persistView(); this.renderList(); }); return el;
      }));
      this.renderList(); this.renderDetail();
    } else if (message.kind === 'action_result' && typeof message.requestId === 'string') {
      const key = this.requests.get(message.requestId); if (key) this.pending.delete(key); this.requests.delete(message.requestId);
      this.notice.textContent = typeof message.error === 'string' ? message.error : message.cancelled ? 'הפעולה בוטלה.' : 'ההוראה התקבלה. ההתקדמות תופיע כאן.';
      this.detail.querySelectorAll<HTMLButtonElement>('button').forEach((el) => { el.disabled = false; });
    } else if (message.kind === 'note' && typeof message.text === 'string') this.notice.textContent = message.text;
  }

  private renderApproval(): void {
    const offer = this.state.approval;
    if (this.approvalId === offer?.id) return;
    this.approvalId = offer?.id; this.approval.replaceChildren(); this.approval.hidden = !offer;
    if (!offer) return;
    this.approval.append(node('h2', 'נדרש אישור לפעולה הזאת'), node('p', offer.question), node('small', 'האישור תקף לבקשה המוצגת בלבד. סגירת החלון או המתנה של שתי דקות מבטלות אותו.'));
    const answer = (accepted: boolean): void => {
      this.approval.querySelectorAll<HTMLButtonElement>('button').forEach((el) => { el.disabled = true; });
      void this.invoke('sidecar_send', { msg: { type: 'session_center_approval', id: offer.id, accepted } }).catch(() => {
        this.notice.textContent = 'לא התקבל אישור מהאפליקציה. הפעולה לא אושרה מחדש.';
      });
    };
    const controls = node('div', '', 'header-actions'); controls.append(button('אישור הפעולה', () => answer(true)), button('ביטול', () => answer(false))); this.approval.append(controls);
    this.approval.scrollIntoView({ block: 'nearest' });
  }

  private persistView(): void {
    this.store.update({ selected: this.selected, filter: this.filter, query: this.search.value });
    const error = this.store.error(); if (error) this.notice.textContent = error;
  }

  private async send(request: Request): Promise<void> {
    const key = 'id' in request && request.id ? `${request.id}:${request.action === 'claude_control_stop' ? 'stop' : 'instruction'}` : request.action;
    if (this.pending.has(key)) return;
    const requestId = crypto.randomUUID(); this.pending.add(key); this.requests.set(requestId, key);
    // Stop is still available while an instruction waits for approval.
    this.notice.textContent = 'הבקשה נשלחה; ממתין לאישור או לתוצאה…';
    try { await this.invoke('sidecar_send', { msg: { ...request, clientRequestId: requestId } }); }
    catch { this.pending.delete(key); this.requests.delete(requestId); this.notice.textContent = 'החיבור לאפליקציה נותק. ההוראה לא נשלחה שוב.'; }
  }

  private renderList(): void {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.session : undefined;
    const rows = sessionRows(this.state, this.filter, this.search.value);
    this.filters.querySelectorAll<HTMLButtonElement>('button').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.filter === this.filter)));
    this.list.replaceChildren();
    if (!rows.length) this.list.append(node('p', this.state.observedAt ? 'אין סשנים בתצוגה הזאת.' : 'טוען את הסשנים…', 'empty'));
    for (const row of rows) {
      const el = button('', () => { this.selected = row.id; this.persistView(); this.renderList(); this.renderDetail(); }); el.dataset.session = row.id;
      el.setAttribute('aria-pressed', String(this.selected === row.id));
      const title = node('strong', row.title); title.dir = 'auto';
      const project = node('small', row.cwd.split('/').filter(Boolean).at(-1) ?? row.cwd); project.dir = 'auto';
      el.append(title, project, node('span', SESSION_LABELS[row.state], `status ${row.state}`)); this.list.append(el);
      if (focused === row.id) el.focus({ preventScroll: true });
    }
  }

  private renderDetail(): void {
    if (this.selected === 'new') {
      if (this.detailKey !== 'new') { this.detailKey = 'new'; this.detail.replaceChildren(renderClaudeControl([], (request) => { void this.send(request); }, this.store)); this.detail.querySelector('details')?.setAttribute('open', ''); }
      return;
    }
    const row = sessionRows(this.state, 'all', '').find((candidate) => candidate.id === this.selected);
    if (!row) { this.detailKey = ''; this.detail.replaceChildren(node('h2', 'בחר סשן כדי להמשיך'), node('p', 'העבודה נשמרת עם ההקשר שלה. כאן אפשר לראות תשובה אחרונה, לשלוח הוראה ולעצור סשן בניהול ג׳ארוויס.')); return; }
    const action = sessionAction(row); const key = `${row.id}:${action}`;
    if (this.detailKey !== key) {
      this.detailKey = key; this.detail.replaceChildren(node('h2', '', 'detail-title'), node('p', '', 'detail-status'), node('p', '', 'detail-project'), node('p', '', 'detail-error'), node('div', '', 'detail-recovery'), node('h3', 'התשובה האחרונה'), node('p', '', 'detail-reply'));
      this.detail.append(renderClaudeInstruction(row.id, row.title, action, (request) => { void this.send(request); }, this.store));
      if (action === 'claude_control_send') this.detail.append(button('עצירת הסשן וביטול התור', () => { void this.send({ type: 'workspace', action: 'claude_control_stop', id: row.id }); }));
    }
    const text = (selector: string, value: string): void => { const el = this.detail.querySelector<HTMLElement>(selector); if (el) { el.textContent = value; el.dir = 'auto'; } };
    text('.detail-title', row.title); text('.detail-project', row.cwd);
    text('.detail-status', `${SESSION_LABELS[row.state]} · ${row.managed ? 'בניהול ג׳ארוויס' : 'שיחה שמורה; פעילות לפי ראיות זמינות'}${row.run?.queued ? ` · ${row.run.queued} הוראות בתור` : ''}`);
    text('.detail-error', row.run?.error ?? ''); text('.detail-reply', row.run?.lastReply || 'טרם התקבלה כאן תשובה. ההיסטוריה המקורית נשמרת ב־Claude.');
    const recovery = this.detail.querySelector('.detail-recovery');
    if (recovery) { recovery.replaceChildren(); if (row.state === 'interrupted') { recovery.append(node('p', 'לפני המשך יש לבדוק מה כבר בוצע. ההוראות הבאות נשמרו לעיון ואינן מורצות מחדש.')); for (const instruction of row.run?.recoveryInstructions ?? []) recovery.append(node('blockquote', instruction)); } }
  }
}

const root = document.getElementById('session-center');
const invoke = window.__TAURI__?.core?.invoke;
if (root && invoke) {
  const store = new SessionViewStore({ getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) });
  const tabs = node('nav', '', 'workspace-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'תצוגת מרחב העבודה');
  const sessions = node('section', '', 'workspace-pane'); const panels = node('section', '', 'workspace-pane');
  sessions.id = 'workspace-sessions'; panels.id = 'workspace-panels';
  sessions.setAttribute('role', 'tabpanel'); panels.setAttribute('role', 'tabpanel');
  const select = (name: 'sessions' | 'panels'): void => {
    sessions.hidden = name !== 'sessions'; panels.hidden = name !== 'panels';
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach((tab) => { const active = tab.dataset.view === name; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
  };
  for (const [name, title] of [['sessions', 'סשנים'], ['panels', 'מסכים']] as const) {
    const tab = button(title, () => select(name)); tab.id = `tab-${name}`; tab.dataset.view = name; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `workspace-${name}`); tabs.append(tab);
    (name === 'sessions' ? sessions : panels).setAttribute('aria-labelledby', tab.id);
    tab.addEventListener('keydown', (event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 'sessions' : event.key === 'End' ? 'panels' : name === 'sessions' ? 'panels' : 'sessions'; select(next); tabs.querySelector<HTMLButtonElement>(`[data-view=${next}]`)?.focus(); });
  }
  root.append(tabs, sessions, panels); select('sessions');
  const view = new SessionCenterView(sessions, invoke, store);
  const libraryRoot = node('div'); const displayRoot = node('div'); panels.append(libraryRoot, displayRoot);
  const library = new PanelLibraryView(libraryRoot, (id) => invoke('sidecar_send', { msg: { type: 'saved_panel_open', id } }));
  const live = new LivePanelView(displayRoot, new PanelViewStateService({ getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }));
  window.__sessionCenter = (message) => {
    if (record(message) && message.kind === 'live_panel_library') library.receive(message);
    else if (record(message) && message.kind === 'live_panel') {
      if (live.receive(message.panel) || message.focus === true) select('panels');
      const receipt = live.receipt();
      if (!panels.hidden && receipt && record(message.panel) && receipt.id === message.panel.id && receipt.revision === message.panel.revision) requestAnimationFrame(() => { void invoke('sidecar_send', { msg: { type: 'live_panel_rendered', ...receipt } }).catch(() => {}); });
    }
    else { view.receive(message); if (record(message) && record(message.snapshot) && message.snapshot.approval) select('sessions'); }
  };
  void invoke('sidecar_send', { msg: { type: 'session_center_open' } });
} else if (root) root.textContent = 'מרכז העבודה מתחבר מתוך אפליקציית Roamies.';

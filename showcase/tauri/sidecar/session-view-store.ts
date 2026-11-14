import type { DraftStorage, SessionViewState, ViewStorage } from './session-view.types.js';

const KEY = 'jarvis.session-center.v1';
const EMPTY: SessionViewState = { version: 1, filter: 'all', query: '', drafts: [] };
const FILTERS = new Set(['all', 'active', 'attention', 'interrupted', 'history']);
const validKey = (key: string): boolean => /^(?:new\.(?:cwd|title|instruction)|[a-f0-9-]{36})$/i.test(key);

/** Local view state only. Restoring never dispatches an action or claims a live session. */
export class SessionViewStore implements DraftStorage {
  private state: SessionViewState = EMPTY;
  private readonly drafts = new Map<string, string>();
  private problem?: string;
  constructor(private readonly storage: ViewStorage) {
    try {
      const raw = storage.getItem(KEY);
      if (!raw) return;
      if (raw.length > 4_000_000) throw new Error('oversize');
      const data: unknown = JSON.parse(raw);
      if (!data || typeof data !== 'object') throw new Error('invalid');
      const value = data as Record<string, unknown>;
      if (value.version !== 1 || typeof value.filter !== 'string' || !FILTERS.has(value.filter)
        || typeof value.query !== 'string' || value.query.length > 200 || !Array.isArray(value.drafts) || value.drafts.length > 50
        || (value.selected !== undefined && (typeof value.selected !== 'string' || !/^(?:new|[a-f0-9-]{36})$/i.test(value.selected)))) throw new Error('invalid');
      for (const entry of value.drafts) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !validKey(entry[0]) || typeof entry[1] !== 'string' || entry[1].length > 12_000) throw new Error('invalid draft');
      }
      this.state = value as unknown as SessionViewState;
      for (const [key, text] of this.state.drafts) this.drafts.set(key, text);
    } catch { this.problem = 'לא ניתן לשחזר את תצוגת הסשנים. ההיסטוריה וההתקדמות עצמן לא השתנו.'; }
  }
  snapshot(): SessionViewState { return { ...this.state, drafts: [...this.drafts] }; }
  error(): string | undefined { return this.problem; }
  get(key: string): string | undefined { return this.drafts.get(key); }
  set(key: string, value: string): void {
    if (!validKey(key)) return;
    this.drafts.delete(key);
    if (value) this.drafts.set(key, value.slice(0, 12_000));
    while (this.drafts.size > 50) this.drafts.delete(this.drafts.keys().next().value!);
    this.persist();
  }
  update(view: Pick<SessionViewState, 'selected' | 'filter' | 'query'>): void {
    this.state = { ...this.state, ...view, query: view.query.slice(0, 200) }; this.persist();
  }
  clearDrafts(): void { this.drafts.clear(); this.persist(); }
  private persist(): void {
    try { this.storage.setItem(KEY, JSON.stringify(this.snapshot())); this.problem = undefined; }
    catch { this.problem = 'הטיוטה זמינה בחלון, אך שמירת התצוגה נכשלה. אין לסגור לפני העתקת טקסט חשוב.'; }
  }
}

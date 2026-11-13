import type { ClaudeRunSnapshot, ClaudeRunState } from './claude-run.types.js';
export interface ClaudeControlAction {
  readonly type: 'workspace';
  readonly action: 'claude_control_start' | 'claude_control_send' | 'claude_control_resume' | 'claude_control_stop';
  readonly id?: string; readonly cwd?: string; readonly title?: string; readonly instruction?: string;
}
const labels: Record<ClaudeRunState, string> = { starting: 'מתחבר', running: 'עובד כעת', waiting: 'ממתין לאישור שלך', idle: 'מוכן להוראה', stopped: 'נעצר', failed: 'ההרצה נכשלה' };
const drafts = new Map<string, string>();
let newSessionOpen = false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = 'workspace-' + (tag === 'article' ? 'session' : 'control');
  if (text) node.textContent = text; return node;
}
function field(label: string, key: string, area = false): { label: HTMLLabelElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const wrapper = el('label', label); const input = area ? el('textarea') : el('input');
  input.dir = 'auto'; input.maxLength = area ? 12_000 : 4096; input.required = true; input.value = drafts.get(key) ?? '';
  input.addEventListener('input', () => { drafts.set(key, input.value); if (drafts.size > 200) drafts.delete(drafts.keys().next().value!); });
  wrapper.append(input); return { label: wrapper, input };
}
function button(label: string, action: () => void): HTMLButtonElement {
  const node = el('button', label); node.type = 'button'; node.className = 'workspace-button'; node.addEventListener('click', action); return node;
}
export function renderClaudeInstruction(id: string, title: string, action: 'claude_control_resume' | 'claude_control_send', send: (action: ClaudeControlAction) => void): HTMLElement {
  const form = el('form'); form.setAttribute('aria-label', `הוראה לסשן ${title}`);
  const text = field('ההוראה ל־Claude', id, true); form.append(text.label);
  const submit = button(action === 'claude_control_resume' ? 'המשך עם ג׳ארוויס' : 'שליחת הוראה', () => {
    if (text.input.value.trim()) send({ type: 'workspace', action, id, instruction: text.input.value.trim() });
  }); form.append(submit); form.addEventListener('submit', (event) => { event.preventDefault(); submit.click(); }); return form;
}
export function renderClaudeControl(runs: readonly ClaudeRunSnapshot[], send: (action: ClaudeControlAction) => void): HTMLElement {
  const section = el('section'); section.setAttribute('aria-label', 'שליטה בסשני Claude');
  section.append(el('h3', 'סשנים בניהול ג׳ארוויס'), el('p', 'אפשר לפתוח סשן, לשלוח הוראות, לעצור ולהמשיך בקול. סשן שפתוח בטרמינל צריך להיסגר שם לפני המשך כאן. עצירה שומרת את ההיסטוריה ומבטלת הוראות שממתינות בתור.'));
  const details = el('details'); details.open = newSessionOpen; details.addEventListener('toggle', () => { if (details.isConnected) newSessionOpen = details.open; }); details.append(el('summary', 'פתיחת סשן חדש'));
  const form = el('form'); const cwd = field('תיקיית פרויקט מלאה', 'new.cwd'); const title = field('שם הסשן', 'new.title'); title.input.maxLength = 160;
  const instruction = field('ההוראה הראשונה', 'new.instruction', true);
  const start = el('button', 'פתיחה עם ג׳ארוויס'); start.type = 'submit'; start.className = 'workspace-button';
  form.append(cwd.label, title.label, instruction.label, start);
  form.addEventListener('submit', (event) => { event.preventDefault(); if (form.reportValidity()) send({ type: 'workspace', action: 'claude_control_start', cwd: cwd.input.value.trim(), title: title.input.value.trim(), instruction: instruction.input.value.trim() }); });
  details.append(form); section.append(details);
  if (!runs.length) section.append(el('p', 'אין כרגע סשנים בניהול ג׳ארוויס. אפשר לפתוח חדש או לבחור שיחה שמורה ולהמשיך אותה.'));
  for (const run of runs) {
    const card = el('article'); const heading = el('h4', run.title); heading.dir = 'auto'; heading.dataset.userContent = '';
    const status = el('p', `${labels[run.state]}${run.queued ? ` · ${run.queued} הוראות בתור` : ''}`); status.setAttribute('role', 'status');
    const project = el('p', run.cwd); project.dir = 'auto'; project.dataset.userContent = '';
    card.append(heading, status, project);
    if (run.error) card.append(el('p', run.error));
    if (run.lastReply) { const reply = el('p', run.lastReply); reply.dir = 'auto'; reply.dataset.userContent = ''; card.append(el('h5', 'התשובה האחרונה'), reply); }
    const ended = run.state === 'stopped' || run.state === 'failed';
    card.append(renderClaudeInstruction(run.id, run.title, ended ? 'claude_control_resume' : 'claude_control_send', send));
    if (!ended) card.append(button('עצירת הסשן וביטול התור', () => send({ type: 'workspace', action: 'claude_control_stop', id: run.id })));
    section.append(card);
  }
  return section;
}

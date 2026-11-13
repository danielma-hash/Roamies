import type { PronunciationEntry, PronunciationPreview } from './pronunciation-dictionary.types.js';

export interface VoiceWorkspaceState {
  readonly entries: readonly PronunciationEntry[];
  readonly preview?: PronunciationPreview;
  readonly warning?: string;
  readonly transcript?: string;
  readonly review?: boolean;
  readonly busy?: boolean;
}

export type VoiceWorkspaceAction =
  | { readonly type: 'workspace'; readonly action: 'voice.save'; readonly term: string; readonly replacement: string }
  | { readonly type: 'workspace'; readonly action: 'voice.remove'; readonly term: string }
  | { readonly type: 'workspace'; readonly action: 'voice.preview' | 'voice.previewAudio' | 'voice.correct'; readonly text: string }
  | { readonly type: 'workspace'; readonly action: 'voice.review'; readonly on: boolean };

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, action: () => void, busy: boolean): HTMLButtonElement {
  const node = element('button', 'workspace-button', label);
  node.type = 'button'; node.disabled = busy;
  node.addEventListener('click', action);
  return node;
}

function textInput(labelText: string, maxLength: number): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = element('label', 'workspace-search-label', labelText);
  const input = element('input', 'workspace-search-input');
  input.type = 'text'; input.dir = 'auto'; input.maxLength = maxLength; input.required = true;
  input.dataset.userContent = ''; label.append(input);
  return { label, input };
}

export function renderVoiceWorkspace(state: VoiceWorkspaceState, send: (message: VoiceWorkspaceAction) => void): HTMLElement {
  const busy = Boolean(state.busy);
  const root = element('section', 'workspace workspace-voice');
  root.dir = 'rtl'; root.lang = 'he'; root.setAttribute('aria-label', 'הגייה ותמלול');
  root.setAttribute('aria-busy', String(busy));
  root.append(element('h2', 'workspace-title', 'הגייה ותמלול'),
    element('p', 'workspace-description', 'מילון אישי לשמות ולמונחים. השינויים חלים על ההקראה, והטקסט המקורי נשאר בשיחה.'));
  if (state.warning) {
    const warning = element('p', 'workspace-feedback', state.warning); warning.setAttribute('role', 'alert'); root.append(warning);
  }

  const reviewLabel = element('label', 'workspace-filter');
  const review = element('input', 'workspace-filter-input'); review.type = 'checkbox'; review.checked = state.review ?? false; review.disabled = busy;
  review.addEventListener('change', () => send({ type: 'workspace', action: 'voice.review', on: review.checked }));
  reviewLabel.append(review, document.createTextNode('בדיקת התמלול לפני שליחה'));
  root.append(reviewLabel);

  if (state.transcript !== undefined) {
    const correction = element('form', 'workspace-detail');
    const label = element('label', 'workspace-handoff-label', 'בדיקה ותיקון של התמלול');
    const text = element('textarea', 'workspace-handoff-text');
    text.value = state.transcript; text.dir = 'auto'; text.rows = 4; text.required = true; text.maxLength = 16_000;
    text.disabled = busy; text.dataset.userContent = ''; label.append(text);
    const confirm = element('button', 'workspace-button', 'שליחת התמלול המתוקן'); confirm.type = 'submit'; confirm.disabled = busy;
    correction.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!busy && text.value.trim()) send({ type: 'workspace', action: 'voice.correct', text: text.value.trim() });
    });
    correction.append(label, confirm); root.append(correction);
  }

  const editor = element('form', 'workspace-search');
  const term = textInput('המונח כפי שהוא כתוב', 80);
  const replacement = textInput('איך להקריא אותו', 160);
  term.input.placeholder = 'למשל: Roamies'; replacement.input.placeholder = 'למשל: רוֹמִיז';
  term.input.disabled = busy; replacement.input.disabled = busy;
  const save = element('button', 'workspace-button', 'שמירת הגייה'); save.type = 'submit'; save.disabled = busy;
  editor.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!busy && term.input.value.trim() && replacement.input.value.trim()) {
      send({ type: 'workspace', action: 'voice.save', term: term.input.value.trim(), replacement: replacement.input.value.trim() });
    }
  });
  editor.append(term.label, replacement.label, save); root.append(editor);
  root.append(element('p', 'workspace-note', `${state.entries.length} מתוך 100 מונחים. אפשר להוסיף ניקוד; יש להזין טקסט רגיל בלבד.`));

  const entries = element('div', 'workspace-sessions'); entries.setAttribute('role', 'list'); entries.setAttribute('aria-label', 'מילון ההגייה האישי');
  if (!state.entries.length) entries.append(element('p', 'workspace-empty', 'עדיין אין הגיות אישיות.'));
  for (const entry of state.entries) {
    const row = element('article', 'workspace-session'); row.setAttribute('role', 'listitem');
    const source = element('h3', 'workspace-session-title', entry.term); source.dir = 'auto'; source.dataset.userContent = '';
    const spoken = element('p', 'workspace-message-text', entry.replacement); spoken.dir = 'auto'; spoken.dataset.userContent = '';
    const actions = element('div', 'workspace-actions');
    const edit = button('עריכה', () => { term.input.value = entry.term; replacement.input.value = entry.replacement; replacement.input.focus(); }, busy);
    edit.setAttribute('aria-label', `עריכת ההגייה של ${entry.term}`);
    const remove = button('מחיקה', () => send({ type: 'workspace', action: 'voice.remove', term: entry.term }), busy);
    remove.setAttribute('aria-label', `מחיקת ההגייה של ${entry.term}`);
    actions.append(edit, remove); row.append(source, spoken, actions); entries.append(row);
  }
  root.append(entries);

  const preview = element('form', 'workspace-detail');
  const previewLabel = element('label', 'workspace-handoff-label', 'משפט לבדיקת ההגייה');
  const input = element('textarea', 'workspace-handoff-text');
  input.value = state.preview?.before ?? ''; input.dir = 'auto'; input.rows = 3; input.maxLength = 4000; input.required = true;
  input.placeholder = 'הקלד משפט שמשלב את המונחים במילון'; input.disabled = busy; input.dataset.userContent = '';
  previewLabel.append(input);
  const actions = element('div', 'workspace-actions');
  const showPreview = element('button', 'workspace-button', 'הצגת ההגייה'); showPreview.type = 'submit'; showPreview.disabled = busy;
  const audioPreview = button('השמעת דוגמה', () => {
    if (input.reportValidity() && input.value.trim()) send({ type: 'workspace', action: 'voice.previewAudio', text: input.value.trim() });
  }, busy);
  actions.append(showPreview, audioPreview);
  preview.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!busy && input.value.trim()) send({ type: 'workspace', action: 'voice.preview', text: input.value.trim() });
  });
  preview.append(previewLabel, actions); root.append(preview);

  if (state.preview) {
    const comparison = element('div', 'workspace-voice-preview');
    comparison.style.display = 'grid'; comparison.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))'; comparison.style.gap = '12px';
    for (const [labelText, value] of [['הטקסט המקורי', state.preview.before], ['הטקסט להקראה', state.preview.after]] as const) {
      const column = element('section', 'workspace-message');
      const body = element('p', 'workspace-message-text', value); body.dir = 'auto'; body.dataset.userContent = '';
      column.append(element('h3', 'workspace-message-role', labelText), body); comparison.append(column);
    }
    root.append(comparison);
  }
  return root;
}

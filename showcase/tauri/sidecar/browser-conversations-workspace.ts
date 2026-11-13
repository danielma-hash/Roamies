import type { ConversationSummary } from './conversation-workspace.service.js';

export interface ConversationsWorkspaceState {
  readonly conversations?: readonly ConversationSummary[];
  readonly conversationPreview?: { readonly id: string; readonly messages: readonly { readonly role: string; readonly text: string }[] };
  readonly busy?: boolean;
  readonly currentConversationId?: string;
}

export type ConversationsWorkspaceAction =
  | { readonly type: 'workspace'; readonly action: 'history.list'; readonly query: string }
  | { readonly type: 'workspace'; readonly action: 'history.read' | 'history.resume'; readonly id: string }
  | { readonly type: 'workspace'; readonly action: 'history.bookmark'; readonly id: string; readonly on: boolean };

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, action: () => void, disabled: boolean): HTMLButtonElement {
  const node = element('button', 'workspace-button', label);
  node.type = 'button'; node.disabled = disabled;
  node.addEventListener('click', () => { if (!node.disabled) action(); });
  return node;
}

function userText<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
  const node = element(tag, className, text);
  node.dir = 'auto'; node.dataset.userContent = '';
  return node;
}

// Only inline code gets a direction override. All content stays text; no HTML or Markdown is executed.
function messageText(text: string): HTMLElement {
  const node = userText('p', 'workspace-message-text', '');
  node.style.whiteSpace = 'pre-wrap'; node.style.overflowWrap = 'anywhere';
  let offset = 0;
  for (const match of text.matchAll(/(?<!`)`([^`\n]+)`(?!`)/gu)) {
    node.append(document.createTextNode(text.slice(offset, match.index)));
    const code = userText('code', 'workspace-message-code', match[1]);
    code.dir = 'ltr'; code.style.unicodeBidi = 'isolate'; node.append(code);
    offset = match.index + match[0].length;
  }
  node.append(document.createTextNode(text.slice(offset)));
  return node;
}

export function renderConversationsWorkspace(state: ConversationsWorkspaceState, send: (message: ConversationsWorkspaceAction) => void): HTMLElement {
  const busy = Boolean(state.busy), conversations = state.conversations ?? [];
  const root = element('section', 'workspace workspace-conversations');
  root.dir = 'rtl'; root.lang = 'he'; root.setAttribute('aria-label', 'היסטוריית השיחות עם Jarvis');
  root.setAttribute('aria-busy', String(busy));
  root.append(element('h2', 'workspace-title', 'השיחות עם Jarvis'),
    element('p', 'workspace-description', 'חיפוש בשיחות שמורות, סימניות וחזרה להקשר קודם. צפייה בשיחה אינה מחליפה את השיחה הפעילה.'));

  const search = element('form', 'workspace-search');
  const label = element('label', 'workspace-search-label', 'חיפוש בהיסטוריית השיחות');
  const input = element('input', 'workspace-search-input');
  input.type = 'search'; input.dir = 'auto'; input.maxLength = 200; input.disabled = busy;
  input.placeholder = 'נושא, שם פרויקט או טקסט מתוך שיחה'; input.dataset.userContent = ''; label.append(input);
  const submit = element('button', 'workspace-button', 'חיפוש ורענון'); submit.type = 'submit'; submit.disabled = busy;
  search.append(label, submit);
  search.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!busy) send({ type: 'workspace', action: 'history.list', query: input.value.trim() });
  });
  root.append(search);

  const cards = element('div', 'workspace-sessions');
  cards.setAttribute('role', 'list'); cards.setAttribute('aria-label', 'שיחות שמורות');
  if (state.conversations === undefined) cards.append(element('p', 'workspace-empty', busy ? 'טוען שיחות…' : 'לחץ על חיפוש ורענון להצגת השיחות השמורות.'));
  else if (!conversations.length) cards.append(element('p', 'workspace-empty', 'לא נמצאו שיחות. אפשר לחפש טקסט אחר או לרענן ללא חיפוש.'));
  for (const conversation of conversations) {
    const card = element('article', 'workspace-session'); card.setAttribute('role', 'listitem');
    if (state.conversationPreview?.id === conversation.id) card.dataset.selected = 'true';
    const current = state.currentConversationId === conversation.id;
    const title = userText('h3', 'workspace-session-title', conversation.title);
    const date = Number.isFinite(conversation.updatedAt) && conversation.updatedAt > 0 ? new Date(conversation.updatedAt).toLocaleString('he-IL') : 'לא ידוע';
    card.append(title, element('p', 'workspace-session-updated', `עודכן: ${date}`));
    if (current) card.append(element('span', 'workspace-session-status', 'השיחה הפעילה'));
    if (conversation.preview) card.append(userText('p', 'workspace-message-text', conversation.preview));
    const actions = element('div', 'workspace-actions');
    const read = button('תצוגה מקדימה', () => send({ type: 'workspace', action: 'history.read', id: conversation.id }), busy);
    read.setAttribute('aria-label', `תצוגה מקדימה: ${conversation.title}`);
    const bookmark = button(conversation.bookmarked ? 'הסרת סימנייה' : 'הוספת סימנייה', () => send({ type: 'workspace', action: 'history.bookmark', id: conversation.id, on: !conversation.bookmarked }), busy);
    bookmark.setAttribute('aria-pressed', String(conversation.bookmarked));
    bookmark.setAttribute('aria-label', `${conversation.bookmarked ? 'הסרת סימנייה' : 'הוספת סימנייה'}: ${conversation.title}`);
    actions.append(read, bookmark); card.append(actions); cards.append(card);
  }
  root.append(cards);

  if (state.conversationPreview) {
    const preview = state.conversationPreview;
    const selected = conversations.find((conversation) => conversation.id === preview.id);
    const detail = element('section', 'workspace-detail'); detail.setAttribute('aria-label', 'תצוגה מקדימה של שיחה שמורה');
    detail.append(userText('h3', 'workspace-detail-title', selected?.title ?? 'תצוגת שיחה שמורה'));
    if (selected) {
      const current = selected.id === state.currentConversationId;
      detail.append(element('p', 'workspace-note', 'המעבר שומר את השיחה הנוכחית וטוען את ההיסטוריה שנבחרה. הודעה חדשה תישלח רק אחרי שתכתוב או תדבר.'));
      const resume = button(current ? 'זו השיחה הפעילה' : `מעבר לשיחה: ${selected.title}`, () => send({ type: 'workspace', action: 'history.resume', id: selected.id }), busy || current);
      resume.dir = 'auto'; resume.dataset.userContent = ''; detail.append(resume);
    } else detail.append(element('p', 'workspace-note', 'כדי לעבור לשיחה הזאת, מצא אותה ברשימה ופתח שוב את התצוגה המקדימה.'));
    if (!preview.messages.length) detail.append(element('p', 'workspace-empty', 'אין הודעות טקסט להצגה.'));
    for (const message of preview.messages) {
      const item = element('article', 'workspace-message'); item.dataset.role = message.role;
      item.append(element('h4', 'workspace-message-role', message.role === 'user' ? 'אתה' : message.role === 'assistant' ? 'Jarvis' : 'הודעה'), messageText(message.text));
      detail.append(item);
    }
    root.append(detail);
  }
  return root;
}

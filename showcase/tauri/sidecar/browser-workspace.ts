import { renderClaudeControl, renderClaudeInstruction } from './browser-claude-control.js';
import type { ClaudeControlAction } from './browser-claude-control.js';
import type { ClaudeRunSnapshot } from './claude-run.types.js';
import type { ClaudeSession, ClaudeTranscript } from './claude-sessions.types.js';
import { renderKnowledgeWorkspace } from './browser-knowledge-workspace.js';
import type { AsmMemoryCitation } from './asm-memory.types.js';
import { renderOperationsWorkspace } from './browser-operations-workspace.js';
import type { OperationsWorkspaceAction } from './browser-operations-workspace.js';
import type { TaskCard } from './task-cards.service.js';
import type { AttentionSnapshot } from './attention.types.js';
import { renderVoiceWorkspace } from './browser-voice-workspace.js';
import type { VoiceWorkspaceState, VoiceWorkspaceAction } from './browser-voice-workspace.js';
import { renderRecipesWorkspace } from './browser-recipes-workspace.js';
import type { RecipesWorkspaceAction } from './project-recipes.types.js';
import type { ProjectRecipe } from './project-recipes.types.js';
import { renderHealthWorkspace } from './browser-health-workspace.js';
import type { EvidenceHealthSnapshot } from './evidence-health.types.js';
import { renderConversationsWorkspace } from './browser-conversations-workspace.js';
import type { ConversationsWorkspaceState, ConversationsWorkspaceAction } from './browser-conversations-workspace.js';

export interface WorkspaceState {
  readonly managedSessions?: readonly ClaudeRunSnapshot[];
  readonly sessions: readonly ClaudeSession[];
  readonly available: boolean;
  readonly message?: string;
  readonly selected?: ClaudeTranscript;
  readonly handoff?: string;
  readonly busy?: boolean;
  readonly error?: string;
  readonly observing?: boolean;
  readonly citations?: readonly AsmMemoryCitation[];
  readonly cards?: readonly TaskCard[];
  readonly attention?: AttentionSnapshot;
  readonly voiceWorkspace?:VoiceWorkspaceState;
  readonly recipes?:readonly ProjectRecipe[];
  readonly health?:EvidenceHealthSnapshot;
  readonly history?:ConversationsWorkspaceState;
  readonly currentConversationId?:string;
}

export type WorkspaceAction =
  | ClaudeControlAction
  | OperationsWorkspaceAction
  | VoiceWorkspaceAction
  | RecipesWorkspaceAction
  | ConversationsWorkspaceAction
  | { readonly type: 'workspace'; readonly action: 'memory.search'; readonly query: string; readonly scope: 'company'|'personal' }
  | { readonly type: 'workspace'; readonly action: 'sessions.list'; readonly query: string }
  | { readonly type: 'workspace'; readonly action: 'sessions.observe' }
  | { readonly type: 'workspace'; readonly action: 'sessions.read' | 'sessions.handoff' | 'sessions.fork'; readonly id: string };

const STATUS: Readonly<Record<ClaudeSession['status'], string>> = {
  running: 'עובד כעת', waiting: 'ממתין לך', idle: 'ממתין להמשך', ended: 'הסתיים', unknown: 'מצב חי לא ידוע',
};
const SECTIONS = [['sessions','Claude'],['history','השיחות שלי'],['knowledge','ASM'],['operations','משימות ועדכונים'],['voice','הגייה ותמלול'],['recipes','מתכונים'],['health','מצב המערכת']] as const;
type Section = typeof SECTIONS[number][0];
let activeSection:Section='sessions';
export function selectSection(section:Section):void{activeSection=section;}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const node = element('button', 'workspace-button', label);
  node.type = 'button'; node.disabled = disabled;
  node.addEventListener('click', onClick);
  return node;
}

/** All session content is rendered as text, including titles and handoff drafts. */
export function render(state: WorkspaceState, send: (message: WorkspaceAction) => void): HTMLElement {
  const root = element('section', 'workspace');
  root.dir = 'rtl'; root.lang = 'he'; root.setAttribute('aria-label', 'מרכז שיחות Claude');
  root.setAttribute('aria-busy', String(Boolean(state.busy)));
  const navigation=element('nav','workspace-navigation');navigation.setAttribute('aria-label','תחומים במרכז העבודה');
  for(const [id,label] of SECTIONS){const tab=button(label,()=>{activeSection=id;root.replaceWith(render(state,send));});tab.setAttribute('aria-pressed',String(activeSection===id));navigation.append(tab);}
  root.append(navigation);
  if(state.error&&activeSection!=='sessions'){const error=element('p','workspace-feedback',state.error);error.setAttribute('role','alert');root.append(error);}
  if(activeSection==='history'){root.append(renderConversationsWorkspace({...state.history,busy:state.busy,currentConversationId:state.currentConversationId},send));return root;}
  if(activeSection==='knowledge'){root.append(renderKnowledgeWorkspace(state,(message)=>send(message as WorkspaceAction)));return root;}
  if(activeSection==='operations'){root.append(renderOperationsWorkspace({...state,cards:state.cards??[]},send));return root;}
  if(activeSection==='voice'){root.append(renderVoiceWorkspace({...state.voiceWorkspace,entries:state.voiceWorkspace?.entries??[],busy:state.busy},send));return root;}
  if(activeSection==='recipes'){root.append(renderRecipesWorkspace({recipes:state.recipes??[],busy:state.busy,message:state.message},send));return root;}
  if(activeSection==='health'){root.append(renderHealthWorkspace(state.health));return root;}
  root.append(element('h2', 'workspace-title', 'שיחות Claude'),
    element('p', 'workspace-description', 'שיחות מקומיות, הודעות אחרונות והכנת המשך עבודה.'));

  root.append(renderClaudeControl(state.managedSessions ?? [], send));
  const form = element('form', 'workspace-search');
  const searchLabel = element('label', 'workspace-search-label', 'חיפוש שיחה או פרויקט');
  const search = element('input', 'workspace-search-input');
  search.type = 'search'; search.dir = 'auto'; search.maxLength = 200;
  search.placeholder = 'שם השיחה, הפרויקט או ה־branch';
  searchLabel.append(search);
  const refresh = element('button', 'workspace-button', 'חיפוש ורענון');
  refresh.type = 'submit'; refresh.disabled = Boolean(state.busy);
  form.append(searchLabel, refresh);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state.busy) send({ type: 'workspace', action: 'sessions.list', query: search.value.trim() });
  });
  root.append(form);
  if (!state.observing) root.append(button('הפעלת עדכוני מצב מ־Claude', () => send({ type: 'workspace', action: 'sessions.observe' }), Boolean(state.busy)), element('p', 'workspace-description', 'נוסף מעקב מקומי להגדרות Claude. נשמרים רק מזהה שיחה, פרויקט וסוג אירוע; ה־hooks הקיימים נשמרים.'));

  const filterLabel = element('label', 'workspace-filter');
  const needsMe = element('input', 'workspace-filter-input'); needsMe.type = 'checkbox';
  filterLabel.append(needsMe, document.createTextNode('רק שיחות שממתינות לי'));
  root.append(filterLabel);

  const feedback = element('p', 'workspace-feedback');
  feedback.setAttribute('role', state.error ? 'alert' : 'status');
  feedback.textContent = state.error || (state.busy ? 'טוען…' : state.message || '');
  if (feedback.textContent) root.append(feedback);
  if (!state.available && !state.busy && !state.message && !state.error) {
    root.append(element('p', 'workspace-empty', 'שיחות Claude אינן זמינות כרגע. אפשר לנסות לרענן.'));
  }

  const cards = element('div', 'workspace-sessions');
  cards.setAttribute('role', 'list'); cards.setAttribute('aria-label', 'שיחות מקומיות');
  const showCards = (): void => {
    cards.replaceChildren();
    const sessions = state.sessions.filter((session) => !needsMe.checked || session.status === 'waiting');
    if (!sessions.length && state.available && !state.busy) {
      cards.append(element('p', 'workspace-empty', needsMe.checked ? 'אין שיחות שממתינות לך לפי האירועים העדכניים.' : 'לא נמצאו שיחות.'));
    }
    for (const session of sessions) {
      const card = element('article', 'workspace-session'); card.setAttribute('role', 'listitem');
      card.dataset.status = session.status;
      if (state.selected?.session.id === session.id) card.dataset.selected = 'true';
      const title = element('h3', 'workspace-session-title', session.title); title.dir = 'auto'; title.dataset.userContent = '';
      const status = element('span', 'workspace-session-status', STATUS[session.status]);
      const project = element('p', 'workspace-session-project', session.cwd || 'פרויקט לא ידוע'); project.dir = 'auto'; project.dataset.userContent = '';
      const branch = element('p', 'workspace-session-branch', session.branch ? `branch: ${session.branch}` : ''); branch.dir = 'auto'; branch.dataset.userContent = '';
      const updated = element('p', 'workspace-session-updated', `עודכן: ${session.updatedAt > 0 ? new Date(session.updatedAt).toLocaleString('he-IL') : 'לא ידוע'}`);
      const read = button('הצגת הודעות', () => send({ type: 'workspace', action: 'sessions.read', id: session.id }), Boolean(state.busy));
      read.setAttribute('aria-label', `הצגת הודעות: ${session.title}`);
      card.append(title, status, project, branch, updated, read);
      cards.append(card);
    }
  };
  needsMe.addEventListener('change', showCards); showCards(); root.append(cards);

  if (state.selected) {
    const { session, messages, truncated } = state.selected;
    const detail = element('section', 'workspace-detail'); detail.setAttribute('aria-label', 'הודעות מהשיחה שנבחרה');
    const title = element('h3', 'workspace-detail-title', session.title); title.dir = 'auto'; title.dataset.userContent = '';
    detail.append(title);
    if (!(state.managedSessions ?? []).some((run) => run.id === session.id)) detail.append(renderClaudeInstruction(session.id, session.title, 'claude_control_resume', send));
    const actions = element('div', 'workspace-actions');
    actions.append(button('הכנת הקשר להמשך', () => send({ type: 'workspace', action: 'sessions.handoff', id: session.id }), Boolean(state.busy)));
    const forkControls = element('div', 'workspace-fork-controls');
    const resetFork = (): void => {
      forkControls.replaceChildren(button('יצירת fork', () => {
        forkControls.replaceChildren(element('p', 'workspace-fork-note', 'תיווצר שיחה חדשה עם ההיסטוריה של השיחה הזאת. ההמשך לא יופעל אוטומטית.'),
          button('אישור יצירת fork', () => {
            forkControls.replaceChildren(element('span', 'workspace-fork-note', 'יוצר fork…'));
            send({ type: 'workspace', action: 'sessions.fork', id: session.id });
          }, Boolean(state.busy)), button('ביטול', resetFork));
      }, Boolean(state.busy)));
    };
    resetFork(); actions.append(forkControls); detail.append(actions);
    if (truncated) detail.append(element('p', 'workspace-note', 'התצוגה מוגבלת להודעות האחרונות; חלק מהתוכן הושמט.'));
    if (!messages.length) detail.append(element('p', 'workspace-empty', 'לא נמצאו הודעות טקסט להצגה.'));
    for (const message of messages) {
      const item = element('article', 'workspace-message'); item.dataset.role = message.role;
      const body = element('p', 'workspace-message-text', message.text); body.dir = 'auto'; body.dataset.userContent = '';
      item.append(element('h4', 'workspace-message-role', message.role === 'user' ? 'משתמש' : 'Claude'), body);
      detail.append(item);
    }
    root.append(detail);
  }

  if (state.handoff) {
    const handoff = element('section', 'workspace-handoff');
    const label = element('label', 'workspace-handoff-label', 'הקשר מוכן להמשך');
    const text = element('textarea', 'workspace-handoff-text');
    text.readOnly = true; text.value = state.handoff; text.dir = 'auto'; text.rows = 12; text.dataset.userContent = '';
    label.append(text); handoff.append(label,
      element('p', 'workspace-note', 'אפשר לבחור ולהעתיק את הטקסט לשיחה שבה תרצה להמשיך.'));
    root.append(handoff);
  }
  return root;
}

declare global {
  interface Window { RoamiesWorkspace: { readonly render: typeof render; readonly selectSection:typeof selectSection }; }
}

if (typeof window !== 'undefined') window.RoamiesWorkspace = { render, selectSection };

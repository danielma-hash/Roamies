import type { EvidenceHealthSnapshot, EvidenceHealthStageId } from './evidence-health.types.js';

const STAGES: Readonly<Record<EvidenceHealthStageId, { readonly title: string; readonly measurement: string; readonly next: string }>> = {
  stt: { title: 'זיהוי דיבור', measurement: 'זמן התמלול שדווח', next: 'כדאי לבדוק את המיקרופון והרשאת ההקלטה ולנסות הקלטה קצרה.' },
  request: { title: 'בקשה מלאה', measurement: 'זמן הבקשה כולל קריאות לכלים', next: 'כדאי לבדוק את חיבור ספק המודל ולנסות שוב.' },
  tools: { title: 'פעולות וכלים', measurement: 'משך הפעולה האחרונה', next: 'כדאי לעיין בפעולה שנכשלה ולבדוק את הרשאות הגישה שלה.' },
  tts: { title: 'יצירת קול', measurement: 'זמן עד האודיו הראשון', next: 'כדאי לבדוק את חיבור ספק הקול והקול שנבחר ולנסות שוב.' },
  playback: { title: 'השמעת אודיו', measurement: 'משך ההשמעה שדווח', next: 'כדאי לבדוק את התקן הפלט ואת עוצמת השמע.' },
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Read-only observed measurements; absent telemetry is never presented as a healthy stage. */
export function renderHealthWorkspace(snapshot?: EvidenceHealthSnapshot): HTMLElement {
  const root = element('section', 'workspace'); root.dir = 'rtl'; root.lang = 'he'; root.setAttribute('aria-label', 'מדידות ואימות פעולות');
  root.append(element('h2', 'workspace-title', 'מדידות ואימות פעולות'),
    element('p', 'workspace-description', 'מדידות מההפעלה הנוכחית. קבלת אודיו אינה מעידה שההשמעה במחשב הושלמה.'));
  const cards = element('div', 'workspace-sessions');
  for (const [id, detail] of Object.entries(STAGES)) {
    const stage = snapshot?.stages.find((item) => item.id === id);
    const card = element('article', 'workspace-session');
    const status = stage?.state === 'error' ? 'נצפתה שגיאה' : stage?.state === 'ok' ? 'נצפה אירוע' : 'טרם נמדד';
    card.append(element('h3', 'workspace-session-title', detail.title), element('span', 'workspace-session-status', status));
    card.append(element('p', 'workspace-note', `${detail.measurement}: ${stage?.durationMs !== undefined ? `${Math.round(stage.durationMs)} ms` : 'טרם נמדד'}`));
    if (stage?.observedAt !== undefined) card.append(element('p', 'workspace-session-updated', `נצפה: ${new Date(stage.observedAt).toLocaleString('he-IL')}`));
    if (stage?.state === 'error') card.append(element('p', 'workspace-feedback', detail.next));
    cards.append(card);
  }
  root.append(cards, element('h3', 'workspace-detail-title', 'פעולות אחרונות'));
  if (!snapshot?.operations.length) root.append(element('p', 'workspace-empty', 'טרם נצפו פעולות כלים בהפעלה הנוכחית.'));
  const labels = { running: 'הופעלה', completed: 'הסתיימה — התוצאה טרם אומתה', verified: 'התוצאה אומתה בבדיקה', error: 'נכשלה' } as const;
  for (const operation of snapshot?.operations ?? []) {
    const row = element('article', 'workspace-message');
    const name = element('h4', 'workspace-message-role', operation.name); name.dir = 'auto'; name.dataset.userContent = '';
    row.append(name, element('p', 'workspace-message-text', labels[operation.state]));
    if (operation.durationMs !== undefined) row.append(element('p', 'workspace-note', `משך: ${Math.round(operation.durationMs)} ms`));
    if (operation.verifiedAt !== undefined) row.append(element('p', 'workspace-session-updated', `אומת: ${new Date(operation.verifiedAt).toLocaleString('he-IL')}`));
    root.append(row);
  }
  return root;
}

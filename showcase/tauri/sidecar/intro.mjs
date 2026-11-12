import { CUE } from './speech.mjs';
import { EMOTES } from './reply.mjs';

// The get-to-know-you chat after setup: a fixed opener, two questions
// that grow out of the answers, then a fixed last one. Each answer goes to the model with a hidden note saying
// where the chat is; the last note has it wrap up. A memory pass over the chat saves what it learned afterwards.
export const QUESTIONS = 4;
const NOTE = '[Getting to know you: a note from the app, not typed by the user]';

// me: the Roamie's own name (its look's: Roamie, JARVIS, Sarah…).
export const opener = (name, me = "רוֹמי") => `שלום ${name}, אני ${me}! אני כאן כדי לעזור לך להתקדם במה שחשוב לך. יש לי ארבע שאלות קצרות להיכרות. על מה אתה עובד בימים אלה?`;

const RULES = (name) => `Always speak natural Israeli Hebrew and address Daniel in masculine singular. This is a short, relaxed get-to-know-you chat; ${name} just set you up. Be a curious friend who happens to be a little pixel creature on their screen, not an interviewer or a coach. You want the general shape of their days: what they do, what they're working on or learning, the apps and projects they live in (by name), and ONE real goal in their words (a launch, a number, a deadline, a thing they want to exist; doing their job well is a full answer, never push for a bigger dream). Never assume they run a business. Never ask about their personal life, what's blocking them, how they'll get there, or their name. No tools this chat. Keep it in bubbles: no "- " lines, no dashes of any kind.
SKIPPING: if they want to skip, stop or get out of this chat (any words, any language), let them: ONE short friendly line with no question in it, and nothing else. Don't argue or ask why.
REQUESTS: if instead of answering they ask you to do something (open, find, write anything), don't do it now and give no links: say in a few words it's a good one to ask you right after these questions, then ask your question again. A request is not an answer, so save nothing from it.`;

/** The first turn: the model says the fixed opener, so it's part of the conversation. */
export const openNote = (name, me) => `${NOTE} ${RULES(name)}
Say EXACTLY this, word for word, nothing before or after: "[wave] ${opener(name, me)}"`;

/** The hidden note that goes with answer `n` (1-based) of QUESTIONS. */
export function answerNote(n, name) {
  const left = QUESTIONS - n;
  const ask = 'React to what they ACTUALLY said first, in a few specific words that prove you heard it, then ask ONE easy question that grows out of it and covers new ground, then two or three concrete ideas of what they could talk about, taken from what they told you ("could be X, Y, or something else entirely"), as a nudge, never a menu or a second question. At most three short sentences, about 35 words.';
  if (left >= 2) return `${NOTE} ${n === 1 ? `${RULES(name)}\n` : 'If they want to stop, one short line with no question. '}That was answer ${n} of ${QUESTIONS}. ${ask} ${left - 1} free question${left - 1 === 1 ? '' : 's'} left after this one, then a fixed last one.${n === 2 ? ' If you still don\'t know the concrete thing they\'re going for, this question gets it, warmly ("what\'s the actual thing, though?").' : ''}`;
  if (left === 1) return `${NOTE} If they want to stop, one short line with no question. That was answer ${n} of ${QUESTIONS}. React to it in a few specific words, then ask the fixed last question, framed as the last one ("okay, last one"): have they used AI helpers before, and which (ChatGPT, Claude, Gemini, an AI that does things on the computer, or none yet)? Light and quick, no explaining what they are. Two short sentences at most.`;
  return `${NOTE} That was their LAST answer. Do not ask anything more.
Wrap up warmly, like a friend ending a good first chat: a few words reacting to what they just said, thank them for telling you about themselves (use ${name}), and one short line naming the thing they talked about most, in THEIR words, as a great place to start. Three short sentences, start with [wave], no promises, no recap, no question.`;
}

/** A chat turn as the memory pass reads it: the user's words without the app's note (the opener note has none). */
export const stripNote = (text) => {
  const t = String(text ?? '');
  if (!t.startsWith(NOTE)) return t;
  const i = t.indexOf('\n\n'), m = i < 0 ? null : /^[^\n]*? said: /.exec(t.slice(i + 2));
  return m ? t.slice(i + 2 + m[0].length) : '';
};

/** Their answer, with the note in front. */
export const answerTurn = (n, name, text) => `${answerNote(n, name)}\n\n${name} said: ${text}`;

/** Plainly "skip"/"stop": ends the chat without asking the model. Anything vaguer ("not now", "can we stop this",
 *  another language) goes to the model, which answers with no question, and that ends it too (endsChat). Words
 *  that can be real answers ("no", "nope", "pass") are never taken as skipping. */
export const wantsSkip = (text) => /^(?:\s*(?:דלג|דילוג|עצור|תעצור|הפסק|תפסיק|ביטול|בטל|לא עכשיו|אחר כך)[\s.!]*$)/u.test(String(text ?? '')) || /^\s*(?:(?:please\s+)?(?:skip|stop|cancel|quit|exit)(?:\s+(?:this|it|that|the questions?|asking|please))?|let'?s skip(?: this| it)?|skip for now)[\s.!]*$/i.test(String(text ?? ''));

/** A reply to an answer that asks nothing means the chat is over (they wanted out). */
export const endsChat = (reply) => !/\?/.test(plain(reply));

/** The question in a reply, for the answer box's placeholder: the last sentence ending in "?". */
export function questionIn(reply, fallback = "התשובה שלך…") {
  const text = String(reply ?? '').replace(/^\s*\[\w+\]\s*/, '').replace(/\s+/g, ' ').trim();
  let q = text.match(/[^.!?]*\?/g)?.at(-1)?.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  // Too long for the box ("Okay, last one: have you used X before, like A, B or C?"): keep the question itself.
  if (q && q.length > 90) {
    const core = q.slice(q.lastIndexOf(':') + 1).split(/,|\s(?:like|such as)\s/)[0].trim().replace(/\?*$/, '?');
    q = core.length >= 8 ? core[0].toUpperCase() + core.slice(1) : '';
  }
  return q && q.length <= 90 ? q : fallback;
}

const TAGS = new RegExp(`\\[(?:${EMOTES.join('|')})\\]`, 'gi');
/** A reply as plain text: no body tags, no voice cues. */
export const plain = (reply) => String(reply ?? '').replace(TAGS, '').replace(CUE, '').replace(/[ \t]+/g, ' ').replace(/ ([,.!?])/g, '$1').trim();

/** One turn for the guide window: the reaction (lead), the question (the heading) and the nudge after it (hint). */
export function splitTurn(reply) {
  const text = plain(reply).replace(/\s+/g, ' ');
  const parts = text.match(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)/g)?.map((x) => x.trim()).filter(Boolean) ?? [];
  let qi = -1;
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].includes('?')) { qi = i; break; }
  if (qi < 0) return { lead: text, question: '', hint: '' };
  return { lead: parts.slice(0, qi).join(' '), question: parts[qi], hint: parts.slice(qi + 1).join(' ') };
}

// ---------- the drawn welcome tour ----------
// After the chat: job tickets for what it can do (each with a button that asks it straight away) and, when the chat
// found one, a medal for their goal. Plain draw beats, so they go through the same checks and overlay as any drawing.
const GOAL = /(?:מטרה|רוצה|שואף|השקה|להשיק|לסיים|לבנות|להגיע)|\b(goal|want(?:s|ed)? to|aim|aiming|launch|build|grow|finish|reach|hit|ship|get to|working towards?|plans? to|dream)\b/i;
/** The fact that reads most like their goal, or null. */
export const goalFrom = (facts = []) => facts.map((f) => String(f.text ?? f)).find((t) => GOAL.test(t)) ?? null;
/** The tour's beats: three tickets and, with a goal, its medal. mac: whether the how-to ticket can use words on screen. */
export function tourBeats(name, me = "רוֹמי", goal = null, { mac = true } = {}) {
  const ask = (value) => ({ do: 'ask', value });
  const beats = [
    { say: `[warm] ${name}, אלה כמה מהדברים שאני יודע לעשות. אפשר ללחוץ על כרטיס ולנסות.`, marks: [{ kind: 'ticket', n: 1, title: "הדרכה על המסך", text: "אפשר לשאול איך עושים משהו באפליקציה ואציג את השלבים על המסך.", label: "ניסיון", action: ask(mac ? "איך מצלמים צילום מסך במק הזה?" : "איך משנים את תמונת הרקע?") }] },
    { say: "אני יכול להמחיש בתרשים כל דבר שמעניין אותך.", marks: [{ kind: 'ticket', n: 2, title: "הסבר ותרשימים", text: "גרפים, צירי זמן, מולקולות ומודלים בתלת־ממד בזמן ההסבר.", label: "ניסיון", action: ask("תסביר לי ריבית דריבית בעזרת גרף") }] },
    { say: "ואעזור לך להתמיד במה שהחלטת לעשות.", marks: [{ kind: 'ticket', n: 3, title: "להתקדם יחד", text: "תגיד מה תרצה לעשות ומתי, ואדאג להזכיר לך.", label: "ניסיון", action: ask("תזכיר לי בעוד עשר דקות לעשות מתיחות") }] },
  ];
  const g = goal && String(goal).replace(/\s+/g, ' ').trim().slice(0, 110);
  if (g) beats.push({ say: `[bright] זו המטרה שלנו, ${name}. אני כאן לעזור.`, marks: [{ kind: 'medal', title: "המטרה שלך", text: g }, { kind: 'emote', name: 'hype' }] });
  return beats.map((b) => ({ ...b, say: b.say.slice(0, 240) }));
}

// ---------- the capability showcase (a setup step) ----------
// A fixed tour of what it can draw, one card per beat, played on the desktop while the guide shows a matching list.
// Hardcoded content (no model call), plain draw beats like the tour above. The last beat only wraps up.
export const SHOWCASE = ['web', 'graph', 'timeline', 'molecule', 'model', 'list'];
const savings = (rate) => Array.from({ length: 16 }, (_, i) => [i * 2, Math.round(1000 * (1 + rate) ** (i * 2))]);
export function showcaseBeats(name, me = "רוֹמי") {
  const beats = [
    { say: `[warm] ${name}, הנה כמה דוגמאות. קודם כול, אני יכול לחפש בשבילך ברשת.`, marks: [{ kind: 'card', title: "חיפוש ברשת", heading: "מה הגובה של האוורסט?", text: "8,849 מטרים. סין ונפאל הסכימו יחד על הגובה הזה בשנת 2020.", sources: [{ name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Mount_Everest' }, { name: 'BBC', url: 'https://www.bbc.com/news/world-asia-55218208' }] }] },
    { say: "אני יכול להציג מספרים בגרף. למשל, איך חיסכון גדל עם הזמן.", marks: [{ kind: 'graph', title: "אלף דולר לאורך שלושים שנה", x_range: [0, 30], plots: [{ points: savings(0.07), tone: 'accent', label: "בריבית של 7%" }, { points: savings(0), tone: 'amber', label: "ללא ריבית" }] }] },
    { say: "ציר זמן עוזר לראות מה קרה ומתי.", marks: [{ kind: 'timeline', title: "המרוץ לחלל", events: [{ when: '1957', text: "ספוטניק" }, { when: '1961', text: "האדם הראשון בחלל" }, { when: '1969', text: "נחיתה על הירח" }, { when: '1998', text: "תחנת החלל" }] }] },
    { say: "וגם מדע. זו מולקולת קפאין, החומר שנמצא בקפה שלך.", marks: [{ kind: 'molecule', smiles: 'CN1C=NC2=C1C(=O)N(C)C(=O)N2C', label: "קפאין" }] },
    { say: "אפשר גם להציג מודלים בתלת ממד. למשל, שבתאי ואחד הירחים שלו.", marks: [{ kind: 'model', title: "שבתאי", parts: [
      { shape: 'sphere', size: [1, 1, 1], tone: 'amber', label: "שבתאי" },
      { shape: 'torus', size: [2.1, 0.5, 2.1], rot: [24, 0, 10], tone: 'white', label: "טבעות" },
      { shape: 'sphere', at: [1.5, 0.5, 0], size: [0.22, 0.22, 0.22], tone: 'sky', label: "טיטאן" }] }] },
    { say: "נתכנן יחד משימות ואעזור לך להתקדם.", marks: [{ kind: 'list', title: "השבוע", items: ["לסיים את המצגת עד יום חמישי", "להתקשר לרופא השיניים", "אימון ביום שני וברביעי"] }] },
    { say: `[bright] זו רק טעימה. אפשר לבקש מ־${me} כל אחד מהדברים האלה בכל זמן.`, marks: [{ kind: 'emote', name: 'hype' }] },
  ];
  return beats.map((b) => ({ ...b, say: b.say.slice(0, 240) }));
}

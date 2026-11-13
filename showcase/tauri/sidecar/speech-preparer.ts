// Speech-only transformations. Never write these forms back into chat or memory.
// @ts-expect-error Existing JS module without declarations.
import { CUE } from './speech.mjs';
import type { SpeechSegment } from './voice.types.js';

const ABBREVIATIONS: Readonly<Record<string, string>> = {
  'ש״ח': 'שקלים', 'דוא״ל': 'דואר אלקטרוני', 'ת״ז': 'תעודת זהות',
  'מס׳': 'מספר', 'טל׳': 'טלפון', 'דק׳': 'דקות', 'ע״י': 'על ידי',
  'ע״פ': 'על פי', 'אחה״צ': 'אחרי הצהריים', 'לפנה״צ': 'לפני הצהריים',
  'בע״מ': 'בערבון מוגבל', 'חו״ל': 'חוץ לארץ', 'בד״כ': 'בדרך כלל',
};
const DIGITS = ['אפס', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע'] as const;
const ENGLISH_DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'] as const;
// A detached unpointed וב was read as English "web" on the mixed-name probe.
// Join its explicit sounds to the English generation instead of synthesizing
// a detached Hebrew letter. English IPA uses Cartesia's documented inventory.
const CLITICS: Readonly<Record<string, string>> = {
  ב: 'b|ɛ', וב: 'u|v|ɛ', ל: 'l|ɛ', ול: 'u|l|ɛ',
  מ: 'm|i', ומ: 'u|m|i', ה: 'h|ɑ', וה: 'v|ɛ|h|ɑ', ש: 'ʃ|ɛ', וש: 'v|ɛ|ʃ|ɛ', ו: 'v|ɛ',
};
const digits = (text: string, hebrew = true): string => [...text.replace(/\D/g, '')].map((digit) => (hebrew ? DIGITS : ENGLISH_DIGITS)[Number(digit)]).join(' ');
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ABBREVIATION = new RegExp(`(?<![\\p{L}\\p{M}])(ו?[בכלמשה]?[־-]?)(${Object.keys(ABBREVIATIONS).sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\p{L}\\p{M}])`, 'gu');
const JARVIS_NAME = /(?<![\p{L}\p{M}\p{N}_])(ו?[בכלמהש]?[־-]?)(?:ג[׳'’]?א?רו{1,2}יס|jarvis)(?![\p{L}\p{M}\p{N}_])/giu;
const JARVIS_ENGLISH = /(?<![\p{L}\p{M}\p{N}_])Jarvis(?![\p{L}\p{M}\p{N}_]|\.[A-Za-z])/gu;
const JARVIS_IPA = '<<ˈ|dʒ|ɑ|ɹ|v|ɪ|s>>';

export class SpeechPreparer {
  normalize(text: string): string {
    const hebrew = /[א-ת]/.test(text) || !/\p{Script=Latin}/u.test(text);
    let value = text.normalize('NFC')
      .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
      .replace(CUE, '')
      .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, ' ')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ')
      .replace(/`([^`]+)`/g, (_match, code: string) => /[\\/{}();=<>]|\w+\.\w+/.test(code) ? ' ' : code)
      .replace(/(?:^|\n)\s*(?:#{1,6}\s+|[-•+]\s+|\d+[.)]\s+)/g, ' ')
      // Star service numbers must precede Markdown cleanup (Vocaly regression).
      .replace(/(?<![\p{L}\p{N}*])\*(\d{3,6})(?![\p{L}\p{N}])/gu, (_match, number: string) => `${hebrew ? 'כוכבית' : 'star'} ${digits(number, hebrew)}`)
      .replace(/\*\*|__|~~|[*_`]/g, '')
      .replace(/[\p{Extended_Pictographic}\u{1f1e6}-\u{1f1ff}\ufe0f\u200d\u20e3]/gu, '')
      .replace(/([א-ת])["״]([א-ת])/g, '$1״$2').replace(/([א-ת])['׳]/g, '$1׳')
      // The name is English even when the reply spells it in Hebrew. Keep
      // canonical text here; provider phonemes are injected after segmentation.
      .replace(JARVIS_NAME, '$1Jarvis')
      .replace(ABBREVIATION, (_match, prefix: string, word: string) => `${prefix}${ABBREVIATIONS[word]}`)
      .replace(/₪\s*(\d[\d,]*(?:\.\d+)?)/g, `$1 ${hebrew ? 'שקלים' : 'shekels'}`)
      .replace(/(\d[\d,]*(?:\.\d+)?)\s*₪/g, `$1 ${hebrew ? 'שקלים' : 'shekels'}`)
      .replace(/(?<![\d.])(\d[\d,]*)\.(\d{1,2})\s*שקלים(?![א-ת])/g, (_match, whole: string, fraction: string) => {
        const agorot = Number(fraction.padEnd(2, '0'));
        return `${whole} שקלים${agorot ? ` ו־${agorot} אגורות` : ''}`;
      })
      .replace(/(\d+(?:\.\d+)?)\s*%/g, `$1 ${hebrew ? 'אחוזים' : 'percent'}`)
      // Explicit identifiers are digits, not quantities. Ordinary amounts stay
      // in context for Cartesia's language-specific number normalizer.
      .replace(/(?<![\p{L}\p{N}])(?:\+972[- .]?|0)(?:\d[- .]?){7,9}\d(?![\p{L}\p{N}])/gu, (phone) => `${phone.startsWith('+') ? hebrew ? 'פלוס ' : 'plus ' : ''}${digits(phone, hebrew)}`)
      .replace(/(?<![\p{L}\p{M}])((?:ו?[בהל]?|ה)(?:קוד|סיסמה|שלוחה|מספר הזמנה|תעודת זהות)\s*(?:הוא|היא|:)?\s*)(\d{2,10})(?![\p{L}\p{N}])/gu, (_match, label: string, number: string) => `${label}${digits(number)}`)
      .replace(/\b((?:code|PIN|OTP)\s*(?:is|:)?\s*)(\d{2,10})(?![\p{L}\p{N}])/giu, (_match, label: string, number: string) => `${label}${digits(number, false)}`)
      .replace(/(\d{1,2}:\d{2})\s*[-–—־]\s*(\d{1,2}:\d{2})/g, `$1 ${hebrew ? 'עד' : 'to'} $2`)
      // Do not replace a homograph everywhere: שמחה as a noun must survive.
      // Full pointing fixed this Sonic 3.6 clause; a single tsere did not.
      .replace(/(^|[.!?,]\s*)(שמחה)(?=\s+ש[א-ת])/g, '$1שְׂמֵחָה')
      // Sonic Hebrew runs through colons; retain a real pause, not a time split.
      .replace(/[:–—]\s+/g, '. ')
      .replace(/[\[\]()]/g, ' ')
      .replace(/\s+([,.;!?])/g, '$1').replace(/\s+/g, ' ').trim();
    if (!/[\p{L}\p{N}]/u.test(value)) value = '';
    return value;
  }

  segment(text: string): SpeechSegment[] {
    // Cartesia recommends one language per generation. Keep a whole English
    // phrase together; never transliterate it into Hebrew or change the voice.
    const runs = text.match(/[\p{Script=Latin}][\p{Script=Latin}\p{M}\d]*(?:[.'’+/#-][\p{Script=Latin}\p{M}\d]+)*(?:\s+[\p{Script=Latin}\p{M}\d]+(?:[.'’+/#-][\p{Script=Latin}\p{M}\d]+)*)*|[^\p{Script=Latin}]+/gu) ?? [];
    const segments: SpeechSegment[] = [];
    let clitic = '';
    for (let index = 0; index < runs.length; index++) {
      let run = runs[index];
      const prefix = clitic;
      clitic = '';
      if (/^\p{Script=Latin}/u.test(runs[index + 1] ?? '')) {
        run = run.replace(/(?<![\p{L}\p{M}])(ו?[בלמהש]|ו)[־-]?\s*$/u, (_match, particle: string) => {
          clitic = `<<${CLITICS[particle]}>> `;
          return '';
        });
      }
      if (!run.trim()) continue;
      const language = /\p{Script=Latin}/u.test(run) ? 'en' : /[א-ת]/.test(run) ? 'he' : segments.at(-1)?.language ?? (/\p{Script=Latin}/u.test(text) ? 'en' : 'he');
      const previous = segments.at(-1);
      if (previous?.language === language) previous.transcript += `${prefix ? ' ' : ''}${prefix}${run}`;
      else segments.push({ language, transcript: `${prefix}${run}` });
    }
    return segments.map((segment) => ({ ...segment, transcript: (segment.language === 'en'
      ? segment.transcript.replace(JARVIS_ENGLISH, JARVIS_IPA) : segment.transcript).trim() }))
      .filter((segment) => /[\p{L}\p{N}]/u.test(segment.transcript));
  }
}

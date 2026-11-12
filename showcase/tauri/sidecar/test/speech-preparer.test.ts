import { describe, expect, it } from 'vitest';
import { SpeechPreparer } from '../speech-preparer.js';

const speech = new SpeechPreparer();
describe('Vocaly speech regressions on the desktop TTS boundary', () => {
  it('speaks Hebrew spellings of Jarvis as the same English name with explicit sounds', () => {
    for (const name of ['ג׳ארוויס', "ג'ארוויס", 'גארוויס', 'ג׳ארויס', 'ג׳רוויס', 'JARVIS', 'Jarvis', 'jarvis']) {
      const normalized = speech.normalize(`שלום, אני ${name}.`);
      expect(normalized).toBe('שלום, אני Jarvis.');
      expect(speech.normalize(normalized)).toBe(normalized);
      expect(speech.segment(normalized)).toEqual([
        { language: 'he', transcript: 'שלום, אני' }, { language: 'en', transcript: '<<ˈ|dʒ|ɑ|ɹ|v|ɪ|s>>.' },
      ]);
    }
    expect(speech.segment(speech.normalize('תגיד לג׳ארוויס ול־JARVIS.'))).toEqual([
      { language: 'he', transcript: 'תגיד' }, { language: 'en', transcript: '<<l|ɛ>> <<ˈ|dʒ|ɑ|ɹ|v|ɪ|s>> <<u|l|ɛ>> <<ˈ|dʒ|ɑ|ɹ|v|ɪ|s>>.' },
    ]);
    for (const other of ['ג׳ארוויסון', 'myJarvis', 'Jarvison', 'Jarvis.ts']) {
      expect(speech.normalize(other)).toBe(other);
      expect(speech.segment(other).map((segment) => segment.transcript).join('')).toBe(other);
    }
    expect(speech.segment('_Jarvis')).toEqual([{ language: 'en', transcript: '_Jarvis' }]);
  });
  it('preserves English phrases, acronyms, versions and Hebrew with niqqud', () => {
    expect(speech.segment('פתח Google Chrome ואז GitHub Actions.')).toEqual([
      { language: 'he', transcript: 'פתח' }, { language: 'en', transcript: 'Google Chrome' },
      { language: 'he', transcript: 'ואז' }, { language: 'en', transcript: 'GitHub Actions.' },
    ]);
    expect(speech.segment('Please use Node.js 22 and ChatGPT.')).toEqual([{ language: 'en', transcript: 'Please use Node.js 22 and ChatGPT.' }]);
    expect(speech.segment('3D printing in Montréal.')).toEqual([{ language: 'en', transcript: '3D printing in Montréal.' }]);
    expect(speech.normalize('הַתּוֹכְנָה בגרסה 3.6 עולה 12.50 ש״ח.')).toBe('הַתּוֹכְנָה בגרסה 3.6 עולה 12 שקלים ו־50 אגורות.');
    expect(speech.segment('ב־ChatGPT ובGitHub')).toEqual([
      { language: 'en', transcript: '<<b|ɛ>> ChatGPT <<u|v|ɛ>> GitHub' },
    ]);
  });
  it('expands unambiguous Hebrew abbreviations with real Unicode boundaries', () => {
    expect(speech.normalize('בדוא"ל ובחו״ל, ע״פ מס׳ 5.')).toBe('בדואר אלקטרוני ובחוץ לארץ, על פי מספר 5.');
    expect(speech.normalize('₪25.50 ו־30₪, 12.5%, 09:30–17:00')).toBe('25 שקלים ו־50 אגורות ו־30 שקלים, 12.5 אחוזים, 09:30 עד 17:00');
    expect(speech.normalize('יום חמישי, שלישי ושישי. נשמר בתחנה.')).toBe('יום חמישי, שלישי ושישי. נשמר בתחנה.');
  });
  it('reads phone numbers, star services and explicit codes digit by digit', () => {
    expect(speech.normalize('חייג *8182 או 050-1234567. קוד: 0042.')).toBe('חייג כוכבית שמונה אחת שמונה שתיים או אפס חמש אפס אחת שתיים שלוש ארבע חמש שש שבע. קוד. אפס אפס ארבע שתיים.');
    expect(speech.normalize('המחיר 1234 שקלים, גרסה 3.6.')).toBe('המחיר 1234 שקלים, גרסה 3.6.');
    expect(speech.normalize('מיקוד 12345. הקוד 0042.')).toBe('מיקוד 12345. הקוד אפס אפס ארבע שתיים.');
    expect(speech.normalize('Call *8182. Your code is 0042. Pay 12.5%.')).toBe('Call star eight one eight two. Your code is zero zero four two. Pay 12.5 percent.');
    expect(speech.normalize('0.05 ש״ח ו־20.00 ש״ח')).toBe('0 שקלים ו־5 אגורות ו־20 שקלים');
  });
  it('removes presentation syntax while keeping bracketed content and link labels', () => {
    expect(speech.normalize('\u202b[warm] **שלום** [דניאל], פתח [GitHub](https://github.com). 😊\u202c')).toBe('שלום דניאל, פתח GitHub.');
    expect(speech.normalize('אלרגנים: (גלוטן, אגוזים).')).toBe('אלרגנים. גלוטן, אגוזים.');
    expect(speech.normalize('בדוק https://example.com ואת `npm install`.')).toBe('בדוק ואת npm install.');
  });
  it('does not turn a noun or an inflected word into a different pronunciation', () => {
    expect(speech.normalize('יופי, שמחה שאתה כאן.')).toBe('יופי, שְׂמֵחָה שאתה כאן.');
    expect(speech.normalize('רגעים של שמחה קטנה. משפחה שמחה.')).toBe('רגעים של שמחה קטנה. משפחה שמחה.');
  });
  it('is idempotent and never modifies the original input', () => {
    const source = '**שלום**, בדוא״ל של GitHub יש קוד 0042.';
    const once = speech.normalize(source);
    expect(speech.normalize(once)).toBe(once);
    expect(source).toContain('**שלום**');
    expect(speech.normalize('😊 **')).toBe('');
  });
});

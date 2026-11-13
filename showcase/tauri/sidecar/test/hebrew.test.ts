import { describe, expect, it } from 'vitest';
import { HEBREW_INSTRUCTIONS, speakableHebrew, translate } from '../hebrew.js';
// @ts-expect-error Existing JS module without declarations.
import { goalFrom, opener, wantsSkip } from '../intro.mjs';

describe('Hebrew UI and voice', () => {
  it('localizes dynamic labels while preserving provider names and shortcuts', () => {
    expect(translate('Step 3 of 8: Connect AI')).toBe('שלב 3 מתוך 8: חיבור AI');
    expect(translate('Add OpenAI API key')).toBe('הוספת מפתח API של OpenAI');
    expect(translate('Hold ⌃⌥ to talk')).toBe('החזק ⌃⌥ כדי לדבר');
    expect(translate('Today: 14 requests · 31.2k tokens')).toBe('היום: 14 בקשות · 31.2k טוקנים');
    expect(translate('Opening OpenAI in your browser. Sign in there!')).toBe('פותח את OpenAI בדפדפן. יש להתחבר שם.');
    expect(translate("Couldn't finish: read budget.xlsx")).toBe('לא הושלם: נקרא: budget.xlsx');
  });
  it('keeps code, credentials, paths and unknown user content verbatim', () => {
    for (const value of ['https://example.com?a=1', '/Users/daniel/file.ts', 'npm run build', 'sk_car_test_123', 'שלום, קוד API בגרסה 3.6']) expect(translate(value)).toBe(value);
  });
  it('prepares Hebrew speech without changing what is displayed', () => {
    expect(speakableHebrew('[warm] JARVIS: המחיר הוא 25 ש״ח.')).toBe('Jarvis. המחיר הוא 25 שקלים.');
    expect(speakableHebrew('[warm] At your service.')).toBe('לשירותך.');
    expect(HEBREW_INSTRUCTIONS).toContain('פנה לדניאל בזכר יחיד');
    expect(HEBREW_INSTRUCTIONS).toContain('עברית ישראלית טבעית');
  });
  it('understands Hebrew onboarding and goals without ASCII word boundaries', () => {
    expect(opener('דניאל', 'JARVIS')).toContain('שלום דניאל');
    for (const phrase of ['דלג', 'תפסיק', 'לא עכשיו', 'ביטול']) expect(wantsSkip(phrase)).toBe(true);
    expect(wantsSkip('אני רוצה לבנות אפליקציה')).toBe(false);
    expect(goalFrom([{ text: 'אני עובד במשרד' }, { text: 'המטרה היא להשיק אפליקציה' }])).toBe('המטרה היא להשיק אפליקציה');
  });
});

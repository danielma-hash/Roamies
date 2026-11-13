import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PronunciationDictionaryService } from '../pronunciation-dictionary.service.js';
import { CartesiaSpeaker } from '../cartesia-speaker.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function dictionary(): Promise<{ service: PronunciationDictionaryService; filePath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'pronunciation-')); directories.push(directory);
  const filePath = join(directory, 'dictionary.json');
  return { service: new PronunciationDictionaryService({ filePath }), filePath };
}

describe('personal pronunciation dictionary', () => {
  it('matches longest literal terms, Hebrew clitics and English inside Hebrew without altering longer words', async () => {
    const { service } = await dictionary();
    await service.upsert({ term: 'GitHub', replacement: 'גיט האב' });
    await service.upsert({ term: 'GitHub Actions', replacement: 'גיט האב אקשנס' });
    expect(service.apply('פתח ב־GitHub Actions ובGitHub; myGitHub GitHubish.')).toBe('פתח ב־גיט האב אקשנס ובגיט האב; myGitHub GitHubish.');
    await service.upsert({ term: 'דניאל', replacement: 'דָּנִיֵּאל' });
    expect(service.apply('לדניאל ודניאל ודניאלה')).toBe('לדָּנִיֵּאל ודָּנִיֵּאל ודניאלה');
  });

  it('handles Jarvis capitalization and Hebrew apostrophe variants without touching displayed text', async () => {
    const { service } = await dictionary();
    await service.upsert({ term: 'Jarvis', replacement: 'ג׳ארוויס' });
    expect(service.preview('JARVIS Jarvis jarvis')).toEqual({ before: 'JARVIS Jarvis jarvis', after: 'ג׳ארוויס ג׳ארוויס ג׳ארוויס' });
    await service.upsert({ term: 'ג׳ארוויס', replacement: 'Jarvis' });
    expect(service.apply("ג׳ארוויס ג'ארוויס ג’ארוויס לג׳ארוויס ג׳ארוויסון")).toBe('Jarvis Jarvis Jarvis לJarvis ג׳ארוויסון');
  });

  it('treats regex syntax literally and rejects provider directives or code', async () => {
    const { service } = await dictionary();
    await service.upsert({ term: 'a.*', replacement: 'literal' });
    expect(service.apply('a.* and abc')).toBe('literal and abc');
    for (const replacement of ['<speak>hi</speak>', '<<dʒ>>', '[whisper]', '`run()`', '${code}', 'hello\nworld']) {
      await expect(service.upsert({ term: 'bad', replacement })).rejects.toThrow('טקסט רגיל');
    }
    expect(service.list()).toHaveLength(1);
  });

  it('persists private entries, reloads, updates case-insensitively and deletes', async () => {
    const { service, filePath } = await dictionary();
    await service.load(); expect(service.warning).toBeUndefined();
    await Promise.all([service.upsert({ term: 'API', replacement: 'איי פי איי' }), service.upsert({ term: 'SDK', replacement: 'אס די קיי' })]);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    const restored = new PronunciationDictionaryService({ filePath });
    expect(await restored.load()).toHaveLength(2);
    await restored.upsert({ term: 'api', replacement: 'ממשק' });
    expect(restored.list()).toHaveLength(2); expect(restored.apply('API')).toBe('ממשק');
    await restored.remove('SDK'); await service.load();
    expect(service.list()).toEqual([{ term: 'api', replacement: 'ממשק' }]);
    expect(await readFile(filePath, 'utf8')).not.toContain('SDK');
  });

  it('falls back to regular speech on invalid files and enforces dictionary and preview bounds', async () => {
    const { service, filePath } = await dictionary();
    await writeFile(filePath, '{invalid');
    expect(await service.load()).toEqual([]); expect(service.warning).toContain('ההגייה הרגילה'); expect(service.apply('שלום')).toBe('שלום');
    await writeFile(filePath, JSON.stringify({ version: 1, entries: Array.from({ length: 100 }, (_, index) => ({ term: `term${index}`, replacement: 'word' })) }));
    expect(await service.load()).toHaveLength(100);
    await expect(service.upsert({ term: 'extra', replacement: 'word' })).rejects.toThrow('100');
    await service.upsert({ term: 'term0', replacement: 'changed' });
    expect(() => service.preview('x'.repeat(4001))).toThrow('4,000');
  });

  it('applies to the actual speech boundary before normalization, preserving the original text and selected voice', async () => {
    const { service } = await dictionary();
    await service.upsert({ term: 'Roamies', replacement: 'רוֹמִיז' });
    const calls: Record<string, unknown>[] = [];
    let finished: (() => void) | undefined;
    const completion = new Promise<void>((resolve) => { finished = resolve; });
    const speaker = new CartesiaSpeaker({ emit: (event) => { if (event.end) finished?.(); }, fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(String(options?.body)) as Record<string, unknown>); return new Response(new Uint8Array([1, 2]));
    } });
    speaker.setPronunciationDictionary((text) => service.apply(text));
    speaker.setKey('test-key'); speaker.setVoice('selected-voice');
    const original = 'שלום Roamies'; const turn = speaker.start()!; turn.say(original); turn.end(); await completion;
    expect(original).toBe('שלום Roamies');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ transcript: 'שלום רוֹמִיז', language: 'he', voice: 'selected-voice' });
  });
});

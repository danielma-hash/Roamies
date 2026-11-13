import { speakableHebrew } from './hebrew.js';
import { SpeechPreparer } from './speech-preparer.js';
import type { SpeakerOptions, SpokenTurn } from './voice.types.js';

export const CARTESIA_API = 'https://api.cartesia.ai';
export const CARTESIA_VERSION = '2026-08-14';
export const CARTESIA_CHOICES = [{ id: 'sonic-3.6', name: 'Cartesia Sonic 3.6' }];
export const DEFAULT_VOICE = '431b7e77-b46d-4eda-8362-db430ac0913c';
export const CARTESIA_VOICES = [
  [DEFAULT_VOICE, 'אורן — גבר, רגוע ומדוד'],
  ['3e32f3c5-9ac0-4192-9994-87fdb277120f', 'נועם — גבר, ברור וסמכותי'],
  ['84b969ad-19c7-428d-b742-48d387f7f138', 'גיל — גבר, חם ושיחתי'],
  ['daa4d6bb-da62-4e16-8065-76cd87942475', 'איתן — גבר, חזק וברור'],
  ['33124162-0d74-48af-ab1c-c1c01bac0247', 'עידו — גבר, נינוח ומרגיע'],
  ['ebc02c0d-61fd-48f2-a6c9-0d6683b7d466', 'איילה — אישה, הבעה וקריינות'],
  ['32a91a5d-05d2-4c1e-bd5a-ff5fd0c413f2', 'תהילה — אישה, רגועה ומדויקת'],
  ['1cd6668f-84b9-41a2-adbd-b7328f8d6ef4', 'הילה — אישה, חמה וברורה'],
  ['4ff88d85-28a2-4870-bdc4-cd9697fd5af5', 'אביבה — אישה, סבלנית ומרגיעה'],
  ['43300c5e-f925-4cd2-adf7-0a031c0e242e', 'עלמה — אישה, חדה ותמציתית'],
] as const;
const RATE = 24000;

export class CartesiaError extends Error {}

export class CartesiaSpeaker {
  private key: string | undefined;
  private voice = DEFAULT_VOICE;
  private seq = 0;
  private current: SpokenTurn | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly preparer = new SpeechPreparer();
  private pronunciation: (text: string) => string = (text) => text;

  constructor(private readonly options: SpeakerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get on(): boolean { return Boolean(this.key); }
  get model(): string { return 'sonic-3.6'; }
  get pick(): string { return this.model; }
  get ready(): number { return 0; }
  setModel(_model: string): void {}
  setVoice(voice: string): void { this.voice = voice || DEFAULT_VOICE; }
  setPronunciationDictionary(apply: (text: string) => string): void { this.pronunciation = apply; }
  setKey(key: string | undefined): void {
    if (this.key !== (key || undefined)) this.stop();
    this.key = key || undefined;
  }

  async check(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.key) return { ok: false, reason: 'key' };
    try {
      const res = await this.fetchImpl(`${CARTESIA_API}/voices?limit=1`, {
        headers: this.headers(this.key), signal: AbortSignal.timeout(6000),
      });
      await res.body?.cancel();
      return { ok: res.ok, ...(!res.ok ? { reason: res.status === 401 || res.status === 403 ? 'key' : 'network' } : {}) };
    } catch { return { ok: false, reason: 'network' }; }
  }

  stop(): void {
    this.current?.abort();
    this.current = undefined;
    this.options.emit({ kind: 'speech', stop: true });
  }

  start(): SpokenTurn | undefined {
    const key = this.key, voice = this.voice;
    if (!key) return undefined;
    this.stop();
    const id = `c${++this.seq}`, controller = new AbortController();
    let queue = Promise.resolve(), ended = false, done = false, chars = 0, heard = false;
    let firstRequestAt: number | undefined;
    const finish = (): void => {
      if (done) return;
      done = true;
      this.options.emit({ kind: 'speech', id, end: true, ...(heard ? { chars } : {}) });
      if (this.current === turn) this.current = undefined;
    };
    const turn: SpokenTurn = {
      id,
      say: (text) => {
        if (done || ended) return;
        // Fish Audio's performance cues aren't Cartesia's text syntax.
        const segments = this.preparer.segment(speakableHebrew(this.pronunciation(text)));
        for (const { transcript, language } of segments) {
          chars += transcript.length;
          queue = queue.then(async () => {
            if (done) return;
            if (firstRequestAt === undefined) { firstRequestAt=Date.now();this.options.log?.('speech_start',{id,model:this.model}); }
            const res = await this.fetchImpl(`${CARTESIA_API}/tts/bytes`, {
              method: 'POST', headers: this.headers(key),
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
              body: JSON.stringify({ model_id: this.model, transcript, voice, language,
                output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: RATE } }),
            });
            if (!res.ok || !res.body) {
              await res.body?.cancel();
              throw new CartesiaError(`Cartesia HTTP ${res.status}`);
            }
            let carry = Buffer.alloc(0);
            for await (const chunk of res.body) {
              if (done) break;
              const bytes = Buffer.concat([carry, Buffer.from(chunk)]), even = bytes.length - bytes.length % 2;
              carry = bytes.subarray(even);
              if (even) {
                if (!heard) this.options.log?.('speech_first_audio', { id, model: this.model, ms:Date.now()-firstRequestAt });
                heard = true;
                this.options.emit({ kind: 'speech', id, rate: RATE, pcm: bytes.subarray(0, even).toString('base64') });
              }
            }
            if (carry.length) throw new CartesiaError('Cartesia returned an incomplete PCM sample');
          }).catch((error: unknown) => {
            if (done) return;
            controller.abort();
            this.options.log?.('speech_error', { id, message: error instanceof Error ? error.message : 'Cartesia failed' });
            finish();
            this.options.onProblem?.('Cartesia');
          });
        }
      },
      beat: () => false,
      end: () => { if (done || ended) return; ended = true; void queue.then(finish); },
      abort: () => { done = true; controller.abort(); if (this.current === turn) this.current = undefined; },
    };
    this.current = turn;
    return turn;
  }

  private headers(key: string): Record<string, string> {
    return { Authorization: `Bearer ${key}`, 'Cartesia-Version': CARTESIA_VERSION, 'Content-Type': 'application/json' };
  }
}

export function createCartesiaSpeaker(options: SpeakerOptions): CartesiaSpeaker { return new CartesiaSpeaker(options); }

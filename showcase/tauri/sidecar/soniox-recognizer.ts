import WebSocket from 'ws';
import { z } from 'zod';
import type { RecognitionCallbacks } from './voice.types.js';

const responseSchema = z.object({
  tokens: z.array(z.object({ text: z.string(), is_final: z.boolean() })).optional(),
  finished: z.boolean().optional(), error_code: z.number().optional(), error_message: z.string().optional(),
});
export class SonioxError extends Error {}

export class SonioxRecognizer {
  private readonly socket: WebSocket;
  private readonly keepalive: ReturnType<typeof setInterval>;
  private readonly timeout: ReturnType<typeof setTimeout>;
  private queued: Buffer[] = [];
  private queuedBytes = 0;
  private ending = false;
  private done = false;
  private finalText = '';

  constructor(key: string, rate: number, private readonly callbacks: RecognitionCallbacks,
    endpoint = 'wss://stt-rt.soniox.com/transcribe-websocket') {
    this.socket = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 6000 });
    this.timeout = setTimeout(() => this.fail(new SonioxError('Soniox connection timed out')), 8000);
    this.socket.on('open', () => {
      clearTimeout(this.timeout);
      this.socket.send(JSON.stringify({ model: 'stt-rt-v6', audio_format: 'pcm_s16le', sample_rate: rate,
        num_channels: 1, language_hints: ['he', 'en'], enable_endpoint_detection: true }));
      for (const chunk of this.queued) this.socket.send(chunk);
      this.queued = []; this.queuedBytes = 0;
      if (this.ending) this.socket.send('');
    });
    this.socket.on('message', (data) => {
      if (this.done) return;
      try {
        const response = responseSchema.parse(JSON.parse(data.toString()));
        if (response.error_code) return this.fail(new SonioxError(`Soniox error ${response.error_code}`));
        let partial = '';
        for (const token of response.tokens ?? []) {
          if (/^<[^>]+>$/.test(token.text)) continue;
          if (token.is_final) this.finalText += token.text; else partial += token.text;
        }
        this.callbacks.onText((this.finalText + partial).trim());
        if (response.finished) { this.cancel(); this.callbacks.onDone(); }
      } catch { this.fail(new SonioxError('Invalid Soniox response')); }
    });
    this.socket.on('error', () => this.fail(new SonioxError('Soniox connection failed')));
    this.socket.on('close', () => { if (!this.done) this.fail(new SonioxError('Soniox closed before completing transcription')); });
    this.keepalive = setInterval(() => {
      if (this.socket.readyState === WebSocket.OPEN && !this.ending) this.socket.send('{"type":"keepalive"}');
    }, 5000);
  }

  append(pcm: Buffer): void {
    if (this.done || this.ending) return;
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(pcm);
    else {
      this.queuedBytes += pcm.length;
      if (this.queuedBytes > 2_000_000) return this.fail(new SonioxError('Soniox connection is too slow'));
      this.queued.push(pcm);
    }
  }
  end(): void {
    if (this.done || this.ending) return;
    this.ending = true;
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send('');
  }
  cancel(): void {
    if (this.done) return;
    this.done = true; clearInterval(this.keepalive); clearTimeout(this.timeout);
    this.queued = [];
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close(); else this.socket.terminate();
  }
  private fail(error: Error): void {
    if (this.done) return;
    this.cancel(); this.callbacks.onError(error);
  }
}

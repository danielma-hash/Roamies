import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { CartesiaSpeaker, CARTESIA_VOICES } from '../cartesia-speaker.js';
import { SonioxRecognizer } from '../soniox-recognizer.js';
import type { SpeechMessage } from '../voice.types.js';

const tick = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 20)); };
const servers: WebSocketServer[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { for (const client of server.clients) client.terminate(); await new Promise<void>((resolve) => server.close(() => resolve())); } });

describe('Cartesia output', () => {
  it('offers five male and five female Hebrew voices with unique IDs', () => {
    expect(CARTESIA_VOICES.filter(([, label]) => label.includes('גבר'))).toHaveLength(5);
    expect(CARTESIA_VOICES.filter(([, label]) => label.includes('אישה'))).toHaveLength(5);
    expect(new Set(CARTESIA_VOICES.map(([id]) => id)).size).toBe(10);
  });
  it('streams complete PCM samples in sentence order and strips Fish cues', async () => {
    const calls: Record<string, unknown>[] = [], events: SpeechMessage[] = [];
    const speaker = new CartesiaSpeaker({ emit: (m) => events.push(m), fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(String(options?.body)) as Record<string, unknown>);
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.enqueue(new Uint8Array([2, 3, 4])); controller.close(); } }));
    } });
    speaker.setKey('test-key');
    const turn = speaker.start()!;
    turn.say('[warm] שלום דניאל.'); turn.say('מה נעשה היום?'); turn.end();
    await tick();
    expect(calls.map((c) => c.transcript)).toEqual(['שלום דניאל.', 'מה נעשה היום?']);
    expect(calls[0]).toMatchObject({ model_id: 'sonic-3.6', language: 'he', output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 } });
    expect(events.filter((e) => e.pcm).map((e) => Buffer.from(e.pcm!, 'base64'))).toEqual([Buffer.from([1, 2, 3, 4]), Buffer.from([1, 2, 3, 4])]);
    expect(events.at(-1)).toMatchObject({ id: turn.id, end: true });
  });
  it('never plays stale audio after Stop or a new turn', async () => {
    const events: SpeechMessage[] = [];
    let release: (() => void) | undefined;
    const speaker = new CartesiaSpeaker({ emit: (m) => events.push(m), fetchImpl: async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return new Response(new Uint8Array([1, 2]));
    } });
    speaker.setKey('test'); const old = speaker.start()!; old.say('שלום'); old.end();
    await tick(); speaker.stop(); release?.(); await tick();
    expect(events.some((e) => e.id === old.id && e.pcm)).toBe(false);
  });
  it('reports HTTP failures once and does not synthesize queued sentences afterward', async () => {
    let calls = 0, errors = 0;
    const speaker = new CartesiaSpeaker({ emit: () => {}, onProblem: () => { errors++; }, fetchImpl: async () => { calls++; return new Response('', { status: 401 }); } });
    speaker.setKey('test'); const turn = speaker.start()!; turn.say('אחד'); turn.say('שתיים'); turn.end(); await tick();
    expect(calls).toBe(1); expect(errors).toBe(1);
  });
});

describe('Soniox input', () => {
  async function server(): Promise<{ server: WebSocketServer; endpoint: string }> {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }); servers.push(server);
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
    return { server, endpoint: `ws://127.0.0.1:${address.port}` };
  }
  it('authenticates, buffers early audio, replaces partials and waits for finished', async () => {
    const { server: ws, endpoint } = await server();
    const messages: (string | Buffer)[] = [], texts: string[] = [];
    const done = new Promise<void>((resolve, reject) => {
      ws.on('connection', (socket, request) => {
        expect(request.headers.authorization).toBe('Bearer private-test-key');
        socket.on('message', (data, binary) => {
          messages.push(binary ? Buffer.from(data as Buffer) : data.toString());
          if (data.toString() === '') {
            socket.send(JSON.stringify({ tokens: [{ text: 'שלום', is_final: true }, { text: ' דנ', is_final: false }] }));
            socket.send(JSON.stringify({ tokens: [{ text: ' דניאל', is_final: true }, { text: '<end>', is_final: true }], finished: true }));
          }
        });
      });
      const recognizer = new SonioxRecognizer('private-test-key', 48000, { onText: (text) => texts.push(text), onDone: resolve, onError: reject }, endpoint);
      recognizer.append(Buffer.from([1, 2])); recognizer.end();
    });
    await done;
    expect(JSON.parse(String(messages[0]))).toMatchObject({ model: 'stt-rt-v6', sample_rate: 48000, language_hints: ['he', 'en'] });
    expect(messages[1]).toEqual(Buffer.from([1, 2])); expect(messages[2]).toBe('');
    expect(texts).toEqual(['שלום דנ', 'שלום דניאל']);
  });
  it('reports a server error without exposing the key', async () => {
    const { server: ws, endpoint } = await server();
    ws.on('connection', (socket) => socket.send(JSON.stringify({ error_code: 401, error_message: 'secret-must-not-leak' })));
    const error = await new Promise<Error>((resolve) => { new SonioxRecognizer('secret-must-not-leak', 24000, { onText: () => {}, onDone: () => {}, onError: resolve }, endpoint); });
    expect(error.message).toBe('Soniox error 401');
  });
});

import { z } from 'zod';
import type { EvidenceHealthError, EvidenceHealthOperation, EvidenceHealthOptions, EvidenceHealthSnapshot, EvidenceHealthStage, EvidenceHealthStageId } from './evidence-health.types.js';

const duration = z.number().finite().min(0).max(86_400_000);
const identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.:-]+$/);
const schemas = {
  voice_final: z.object({ ms: duration }),
  request: z.object({ turn: z.number().int().nonnegative() }),
  request_done: z.object({ turn: z.number().int().nonnegative(), ms: duration }),
  stalled: z.object({ turn: z.number().int().nonnegative(), ms: duration }),
  tool: z.object({ id: identifier, name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/) }),
  tool_done: z.object({ id: identifier, ms: duration.optional() }),
  tool_error: z.object({ id: identifier, ms: duration.optional() }),
  speech_start: z.object({ id: identifier }),
  speech_first_audio: z.object({ id: identifier, ms: duration.optional() }),
  speech_error: z.object({ id: identifier }),
  playback_done: z.object({ ms: duration }),
  playback_error: z.object({}),
  problem: z.object({ area: z.enum(['reply', 'hearing', 'screen']) }),
} as const;

/** In-memory observed evidence only. Event payload text, tool arguments and results are discarded. */
export class EvidenceHealthService {
  private readonly now: () => number;
  private lastAt = 0;
  private readonly stages = new Map<EvidenceHealthStageId, EvidenceHealthStage>(
    (['stt', 'request', 'tools', 'tts', 'playback'] as const).map((id) => [id, { id, state: 'unknown' }]),
  );
  private readonly operations = new Map<string, EvidenceHealthOperation>();
  private readonly speech = new Map<string, { readonly startedAt?: number; readonly failed: boolean }>();
  private readonly failedRequests = new Set<number>();
  private activeRequest: number | undefined;

  constructor(options: EvidenceHealthOptions = {}) { this.now = options.now ?? Date.now; }

  record(kind: string, data: unknown): boolean {
    if (!Object.hasOwn(schemas, kind)) return false;
    const parsed = schemas[kind as keyof typeof schemas].safeParse(data);
    if (!parsed.success) return false;
    const event = parsed.data;
    const at = this.timestamp();
    if (kind === 'voice_final' && 'ms' in event) this.observe('stt', kind, at, event.ms);
    else if (kind === 'request' && 'turn' in event) this.activeRequest = event.turn;
    else if ((kind === 'request_done' || kind === 'stalled') && 'turn' in event && 'ms' in event) {
      if (kind === 'stalled') this.failRequest(event.turn);
      this.observe('request', kind, at, event.ms, this.failedRequests.has(event.turn) ? (kind === 'stalled' ? 'request-stalled' : 'request-error') : undefined);
      if (kind === 'request_done' && this.activeRequest === event.turn) this.activeRequest = undefined;
    } else if (kind === 'tool' && 'id' in event && 'name' in event) {
      if (!this.operations.has(event.id)) this.operations.set(event.id, { id: event.id, name: event.name, state: 'running', observedAt: at });
      this.trim(this.operations, 20);
    } else if ((kind === 'tool_done' || kind === 'tool_error') && 'id' in event) {
      const previous = this.operations.get(event.id);
      if (kind === 'tool_done' && previous && ['verified', 'completed', 'error'].includes(previous.state)) return false;
      const ms = 'ms' in event ? event.ms : undefined;
      this.operations.set(event.id, {
        id: event.id, name: previous?.name ?? 'tool', state: kind === 'tool_error' ? 'error' : 'completed',
        observedAt: at, ...(ms !== undefined ? { durationMs: ms } : {}),
      });
      this.trim(this.operations, 20);
      this.observe('tools', kind, at, ms, kind === 'tool_error' ? 'tool-error' : undefined);
    } else if (kind === 'speech_start' && 'id' in event) {
      this.speech.set(event.id, { startedAt: at, failed: false }); this.trim(this.speech, 64);
    } else if (kind === 'speech_first_audio' && 'id' in event) {
      const previous = this.speech.get(event.id);
      if (previous?.failed) return false;
      const ms = 'ms' in event && event.ms !== undefined ? event.ms : previous?.startedAt !== undefined ? at - previous.startedAt : undefined;
      this.observe('tts', kind, at, ms);
    } else if (kind === 'speech_error' && 'id' in event) {
      this.speech.set(event.id, { failed: true }); this.trim(this.speech, 64);
      this.observe('tts', kind, at, undefined, 'speech-error');
    } else if (kind === 'playback_done' && 'ms' in event) this.observe('playback', kind, at, event.ms);
    else if (kind === 'playback_error') this.observe('playback', kind, at, undefined, 'playback-error');
    else if (kind === 'problem' && 'area' in event) {
      if (event.area === 'reply') {
        if (this.activeRequest !== undefined) this.failRequest(this.activeRequest);
        this.observe('request', kind, at, undefined, 'request-error');
      } else this.observe(event.area === 'hearing' ? 'stt' : 'tools', kind, at, undefined, event.area === 'hearing' ? 'hearing-error' : 'tool-error');
    }
    return true;
  }

  /** Caller must supply an actual tool result and a deterministic check for the requested postcondition. */
  verifyOperation(id: string, actualToolResult: unknown, predicate: (result: unknown) => boolean): boolean {
    const previous = this.operations.get(id);
    if (!previous || previous.state !== 'completed' || actualToolResult === undefined) return false;
    try { if (predicate(actualToolResult) !== true) return false; } catch { return false; }
    this.operations.set(id, { ...previous, state: 'verified', verifiedAt: this.timestamp() });
    return true;
  }

  snapshot(): EvidenceHealthSnapshot {
    return structuredClone({ stages: [...this.stages.values()], operations: [...this.operations.values()].reverse() });
  }

  private timestamp(): number {
    const now = this.now();
    if (Number.isFinite(now)) this.lastAt = Math.max(this.lastAt, now);
    return this.lastAt;
  }

  private observe(id: EvidenceHealthStageId, evidence: string, at: number, durationMs?: number, error?: EvidenceHealthError): void {
    this.stages.set(id, { id, state: error ? 'error' : 'ok', evidence, observedAt: at,
      ...(durationMs !== undefined ? { durationMs } : {}), ...(error ? { error } : {}) });
  }

  private failRequest(turn: number): void {
    this.failedRequests.add(turn);
    while (this.failedRequests.size > 64) this.failedRequests.delete(this.failedRequests.values().next().value!);
  }

  private trim<T>(items: Map<string, T>, limit: number): void {
    while (items.size > limit) items.delete(items.keys().next().value!);
  }
}

import { describe, expect, it } from 'vitest';
import { EvidenceHealthService } from '../evidence-health.service.js';
import type { EvidenceHealthStageId } from '../evidence-health.types.js';

const stage = (service: EvidenceHealthService, id: EvidenceHealthStageId) => service.snapshot().stages.find((item) => item.id === id);

describe('observed health evidence', () => {
  it('starts entirely unknown and does not invent latency, costs, or successful playback', () => {
    const service = new EvidenceHealthService();
    expect(service.snapshot().stages).toHaveLength(5);
    expect(service.snapshot().stages.every((item) => item.state === 'unknown' && item.durationMs === undefined && item.observedAt === undefined)).toBe(true);
    expect(service.record('speech_first_audio', { id: 'c1', model: 'sonic-3.6' })).toBe(true);
    expect(stage(service, 'tts')).toMatchObject({ state: 'ok', evidence: 'speech_first_audio' });
    expect(stage(service, 'tts')?.durationMs).toBeUndefined();
    expect(stage(service, 'playback')?.state).toBe('unknown');
    expect(JSON.stringify(service.snapshot())).not.toMatch(/cost|price|tokens/);
  });

  it('retains only allowed numeric observations and discards text, args, results and secrets', () => {
    const service = new EvidenceHealthService({ now: () => 1000 });
    service.record('voice_final', { ms: 240, via: 'soniox', chars: 12, text: 'private transcript', api_key: 'secret' });
    service.record('tool', { id: 'call1', name: 'read_file', args: { path: '/secret' } });
    service.record('tool_done', { id: 'call1', ms: 30, result: 'private contents', verified: true });
    service.record('speech_error', { id: 'c1', message: 'token=private-token' });
    expect(stage(service, 'stt')).toMatchObject({ state: 'ok', durationMs: 240, observedAt: 1000 });
    expect(service.snapshot().operations[0]?.state).toBe('completed');
    const output = JSON.stringify(service.snapshot());
    for (const sensitive of ['private', '/secret', 'api_key', 'transcript', 'args', 'result']) expect(output).not.toContain(sensitive);
  });

  it('accepts finite bounded durations only and ignores non-whitelisted events', () => {
    const service = new EvidenceHealthService();
    for (const ms of [-1, NaN, Infinity, 86_400_001, '100']) expect(service.record('voice_final', { ms })).toBe(false);
    expect(service.record('voice_final', null)).toBe(false);
    expect(service.record('__proto__', {})).toBe(false);
    expect(service.record('error', 'raw stack trace')).toBe(false);
    expect(service.record('trail_success', { verified: true })).toBe(false);
    expect(service.snapshot().stages.every((item) => item.state === 'unknown')).toBe(true);
    expect(service.record('voice_final', { ms: 0 })).toBe(true);
    expect(stage(service, 'stt')?.durationMs).toBe(0);
  });

  it('distinguishes a full request duration from individual tool timing', () => {
    const service = new EvidenceHealthService({ now: () => 2000 });
    service.record('request', { turn: 1, chars: 42 });
    service.record('tool', { id: 'call1', name: 'read_window' });
    service.record('tool_done', { id: 'call1', ms: 200 });
    service.record('request_done', { turn: 1, ms: 900, in: 500, out: 100 });
    expect(stage(service, 'request')).toMatchObject({ state: 'ok', durationMs: 900 });
    expect(stage(service, 'tools')).toMatchObject({ state: 'ok', durationMs: 200 });
  });

  it('does not hide a stalled or failed request when request_done later arrives', () => {
    const service = new EvidenceHealthService();
    service.record('request', { turn: 1 });
    service.record('stalled', { turn: 1, ms: 60000 });
    service.record('request_done', { turn: 1, ms: 60001 });
    expect(stage(service, 'request')?.state).toBe('error');
    service.record('request', { turn: 2 });
    service.record('problem', { area: 'reply', code: 'arbitrary-token', raw: 'private error' });
    service.record('request_done', { turn: 2, ms: 30 });
    expect(stage(service, 'request')?.state).toBe('error');
    service.record('request', { turn: 3 });
    service.record('request_done', { turn: 3, ms: 100 });
    expect(stage(service, 'request')?.state).toBe('ok');
  });

  it('requires an actual result and successful predicate before marking a completed operation verified', () => {
    const service = new EvidenceHealthService({ now: () => 1000 });
    service.record('tool', { id: 'call1', name: 'write_file' });
    expect(service.verifyOperation('call1', { exists: true }, () => true)).toBe(false);
    service.record('tool_done', { id: 'call1', ms: 10 });
    expect(service.verifyOperation('missing', {}, () => true)).toBe(false);
    expect(service.verifyOperation('call1', undefined, () => true)).toBe(false);
    expect(service.verifyOperation('call1', { exists: false }, () => false)).toBe(false);
    expect(service.verifyOperation('call1', {}, () => { throw new Error('failed'); })).toBe(false);
    expect(service.snapshot().operations[0]?.state).toBe('completed');
    const actual = { exists: true, contents: 'private evidence content' };
    expect(service.verifyOperation('call1', actual, (result) => result === actual && actual.exists)).toBe(true);
    expect(service.snapshot().operations[0]).toMatchObject({ state: 'verified', verifiedAt: 1000 });
    expect(JSON.stringify(service.snapshot())).not.toContain('private evidence');
    expect(service.record('tool_done', { id: 'call1', ms: 10 })).toBe(false);
    expect(service.snapshot().operations[0]?.state).toBe('verified');
  });

  it('never upgrades a failed operation, even when a success log or verification follows', () => {
    const service = new EvidenceHealthService();
    service.record('tool', { id: 'call1', name: 'run_command' });
    service.record('tool_error', { id: 'call1', ms: 50, result: 'failed' });
    expect(service.record('tool_done', { id: 'call1', ms: 51 })).toBe(false);
    expect(service.verifyOperation('call1', { ok: true }, () => true)).toBe(false);
    expect(service.snapshot().operations[0]?.state).toBe('error');
  });

  it('uses speech start timing when present, keeps timestamps monotonic, and does not clear errors with late audio', () => {
    let now = 1000;
    const service = new EvidenceHealthService({ now: () => now });
    service.record('speech_start', { id: 'c1' });
    now = 1250;
    service.record('speech_first_audio', { id: 'c1' });
    expect(stage(service, 'tts')?.durationMs).toBe(250);
    now = 1100;
    service.record('speech_error', { id: 'c1' });
    expect(stage(service, 'tts')?.observedAt).toBe(1250);
    expect(service.record('speech_first_audio', { id: 'c1', ms: 300 })).toBe(false);
    expect(stage(service, 'tts')?.state).toBe('error');
    service.record('speech_first_audio', { id: 'c2', ms: 75 });
    expect(stage(service, 'tts')).toMatchObject({ state: 'ok', durationMs: 75 });
  });

  it('requires an explicit playback event and maps only known problem areas', () => {
    const service = new EvidenceHealthService();
    expect(service.record('problem', { area: 'unknown', raw: 'do not store' })).toBe(false);
    service.record('problem', { area: 'hearing', raw: 'private' });
    expect(stage(service, 'stt')).toMatchObject({ state: 'error', error: 'hearing-error' });
    service.record('playback_done', { ms: 1200 });
    expect(stage(service, 'playback')).toMatchObject({ state: 'ok', durationMs: 1200 });
    service.record('playback_error', { raw: 'device details' });
    expect(stage(service, 'playback')).toMatchObject({ state: 'error', error: 'playback-error' });
  });

  it('keeps only twenty operations and snapshots cannot mutate retained evidence', () => {
    const service = new EvidenceHealthService();
    for (let i = 0; i < 25; i++) {
      service.record('tool', { id: `call${i}`, name: 'read_file' });
      service.record('tool_done', { id: `call${i}`, ms: i });
    }
    const snapshot = service.snapshot();
    expect(snapshot.operations).toHaveLength(20);
    expect(snapshot.operations[0]?.id).toBe('call24');
    expect(snapshot.operations.at(-1)?.id).toBe('call5');
    Object.assign(snapshot.operations[0]!, { state: 'verified' });
    expect(service.snapshot().operations[0]?.state).toBe('completed');
  });
});

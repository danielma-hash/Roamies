import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceTools } from '../workspace-tools.js';
import { createAsmTool } from '../asm-tool.js';
import { ClaudeSessionsService } from '../claude-sessions.service.js';
import { AsmMemoryService } from '../asm-memory.service.js';
// @ts-expect-error Existing production Claude MCP bridge is JavaScript.
import { createToolBridge } from '../claudecode.mjs';

interface RpcResponse { readonly id: number; readonly result: { readonly content: readonly { readonly type: string; readonly text: string }[]; readonly isError?: boolean } }

async function bridgeRpc(tools: unknown): Promise<(name: string, args: Record<string, unknown>) => Promise<RpcResponse['result']>> {
  const bridge = createToolBridge({ tools, onEvent: () => {}, maxToolResultChars: 24_000 });
  const waiting = new Map<number, (reply: RpcResponse) => void>();
  const transport: { onmessage?: (value: unknown) => void; send: (reply: RpcResponse) => Promise<void> } = {
    send: async (reply) => { waiting.get(reply.id)?.(reply); },
  };
  await bridge.config.instance.connect(transport);
  let sequence = 0;
  return async (name, args) => {
    const id = ++sequence;
    const reply = new Promise<RpcResponse>((resolve) => { waiting.set(id, resolve); });
    transport.onmessage?.({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    return (await reply).result;
  };
}

describe('workspace tools through the actual Claude MCP adapter', () => {
  it('delivers list, transcript, handoff, fork and ASM values as model-readable text', async () => {
    const id = '12345678-1234-4567-8901-123456789abc';
    const forkId = '12345678-1234-4567-8901-123456789abd';
    const sessions = new ClaudeSessionsService({ sdk: {
      listSessions: async () => [{ sessionId: id, summary: 'בדיקת כלים', cwd: '/project', lastModified: 1 }],
      getSessionMessages: async () => [{ type: 'assistant', message: { content: 'תוצאה אמיתית' } }],
      forkSession: async () => ({ sessionId: forkId }),
    } });
    const memory = new AsmMemoryService();
    vi.spyOn(memory, 'search').mockResolvedValue([{ source: 'memory', id: 'memory:test', title: 'החלטה', excerpt: 'פרט מהזיכרון', path: '/project/note', status: 'active' }]);
    const rpc = await bridgeRpc([...createWorkspaceTools({ sessions, allowActions: () => true, confirm: async () => true }), createAsmTool(memory)]);
    const cases: readonly [string, Record<string, unknown>, string][] = [
      ['claude_sessions', {}, 'בדיקת כלים'], ['claude_session_read', { id }, 'תוצאה אמיתית'],
      ['claude_session_handoff', { id }, 'מזהה מקור'], ['claude_session_fork', { id }, forkId],
      ['asm_recall', { query: 'החלטה', scope: 'company' }, 'פרט מהזיכרון'],
    ];
    for (const [name, args, expected] of cases) {
      const result = await rpc(name, args);
      expect(result.isError).not.toBe(true);
      expect(result.content[0].type).toBe('text'); expect(result.content[0].text).toContain(expected);
      expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    }
  });

  it('delivers deny, cancelled, unavailable and thrown-error responses through the same adapter', async () => {
    const id = '12345678-1234-4567-8901-123456789abc';
    const sessions = new ClaudeSessionsService({ sdk: { listSessions: async () => [{ sessionId: id, summary: 'test', cwd: '/project', lastModified: 1 }], getSessionMessages: async () => [] } });
    await sessions.list();
    const denied = await bridgeRpc(createWorkspaceTools({ sessions, allowActions: () => false, confirm: async () => true }));
    expect((await denied('claude_session_fork', { id })).content[0].text).toContain('הפעלת פעולות');
    const cancelled = await bridgeRpc(createWorkspaceTools({ sessions, allowActions: () => true, confirm: async () => false }));
    expect(JSON.parse((await cancelled('claude_session_fork', { id })).content[0].text)).toEqual({ cancelled: true });
    const missing = await denied('claude_session_read', { id: 'unknown' });
    expect(missing.isError).toBe(true); expect(missing.content[0].text).toContain('לא נמצאה');
    const unavailable = await bridgeRpc(createWorkspaceTools({ sessions: new ClaudeSessionsService({ sdk: {} }), allowActions: () => false, confirm: async () => false }));
    expect(JSON.parse((await unavailable('claude_sessions', {})).content[0].text)).toMatchObject({ available: false });
  });
});

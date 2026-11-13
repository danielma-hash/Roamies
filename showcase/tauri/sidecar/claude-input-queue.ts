import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/** The input stays open between turns; closing it would end the SDK control channel. */
export class ClaudeInputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly pending: SDKUserMessage[] = [];
  private wake?: () => void;
  private closed = false;
  push(text: string): void {
    if (this.closed) throw new Error('השיחה נסגרה.');
    this.pending.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
    this.wake?.();
  }
  close(): void { this.closed = true; this.pending.length = 0; this.wake?.(); }
  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (!this.closed) {
      const message = this.pending.shift();
      if (message) yield message;
      else await new Promise<void>((resolve) => { this.wake = resolve; });
    }
  }
}

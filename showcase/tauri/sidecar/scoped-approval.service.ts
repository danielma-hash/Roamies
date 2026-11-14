import { randomUUID } from 'node:crypto';
import type { ApprovalOffer } from './scoped-approval.types.js';

/** One exact, short-lived decision. No remembered grants or inferred consent. */
export class ScopedApprovalService {
  private pending?: { readonly offer: ApprovalOffer; readonly finish: (accepted: boolean) => void };
  constructor(private readonly changed: () => void, private readonly ttlMs = 120_000) {}
  current(): ApprovalOffer | undefined { return this.pending?.offer; }
  request(question: string, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted || this.pending) return Promise.resolve(false);
    return new Promise((resolve) => {
      const offer: ApprovalOffer = { id: randomUUID(), question: question.slice(0, 16_000), expiresAt: Date.now() + this.ttlMs };
      const abort = (): void => finish(false);
      const timer = setTimeout(abort, this.ttlMs); timer.unref?.();
      const finish = (accepted: boolean): void => {
        if (this.pending?.offer.id !== offer.id) return;
        clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending = undefined;
        resolve(accepted); this.changed();
      };
      this.pending = { offer, finish }; signal?.addEventListener('abort', abort, { once: true }); this.changed();
    });
  }
  answer(id: string, accepted: boolean): boolean {
    const pending = this.pending;
    if (!pending || pending.offer.id !== id) return false;
    pending.finish(accepted && Date.now() < pending.offer.expiresAt); return true;
  }
  cancel(): void { this.pending?.finish(false); }
}

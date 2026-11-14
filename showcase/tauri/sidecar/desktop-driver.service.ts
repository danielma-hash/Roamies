import { randomUUID } from 'node:crypto';
import { z } from 'zod';
// @ts-expect-error Existing app safety module is JavaScript.
import { checkDesktopAction, BLOCK, ASK } from './safety.mjs';
import type { DesktopAction, DesktopDriverOptions, DesktopElement, DesktopPolicy, DesktopSnapshot } from './desktop-driver.types.js';

const REF = /^@s[a-z0-9]{1,40}:e\d{1,7}$/;
const envelope = z.object({ version: z.literal('2.6'), ok: z.boolean(), data: z.unknown().optional() });
const policySchema = z.object({ windowId: z.number().int().positive(), pid: z.number().int().positive(), bundle: z.string().min(1), app: z.string().min(1).max(200), instance: z.string().min(1), title: z.string(), protected: z.boolean(), trusted: z.boolean() });
const windowSchema = z.object({ id: z.string().regex(/^w-\d{1,10}$/), pid: z.number().int().positive(), process_instance: z.string().min(1), visible: z.boolean() });
const nodeSchema = z.object({ role: z.string().default(''), name: z.string().default(''), value: z.unknown().optional(), ref_id: z.string().regex(REF).optional(), available_actions: z.array(z.string()).default([]), states: z.array(z.string()).default([]), children: z.array(z.unknown()).default([]) });
interface Binding { readonly policy: DesktopPolicy; readonly processInstance: string; readonly element: DesktopElement; readonly time: number; }
export class DesktopDriverError extends Error { override readonly name = 'DesktopDriverError'; }

export class DesktopDriverService {
  private readonly session = `jarvis-${randomUUID()}`;
  private readonly bindings = new Map<string, Binding>();
  private readonly busy = new Set<number>();
  private readonly now: () => number;
  constructor(private readonly options: DesktopDriverOptions) { this.now = options.now ?? Date.now; }
  private async call(args: readonly string[], text?: string, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const result = envelope.parse(await this.options.run([...args, '--session', this.session], text, signal));
    if (!result.ok) throw new DesktopDriverError('agent-desktop לא אישר שהבקשה הושלמה. אין לנסות את הפעולה שוב בלי קריאה חדשה.');
    return result.data;
  }
  private async owner(windowId: number, signal?: AbortSignal) {
    const policy = policySchema.parse(await this.options.policy(windowId));
    if (policy.windowId !== windowId) throw new DesktopDriverError('שיוך החלון השתנה.');
    const verdict = checkDesktopAction('read', policy);
    if (verdict.level === BLOCK) throw new DesktopDriverError(verdict.reason);
    // Global inventory can wait for an unrelated frontmost app. Native window ownership
    // gives an exact app scope first, without reading any other application's AX tree.
    const windows = z.array(windowSchema).parse(await this.call(['list-windows', '--app', policy.app, '--timeout-ms', '2000'], undefined, signal));
    const window = windows.find((row) => row.id === `w-${windowId}` && row.visible);
    if (!window) throw new DesktopDriverError('החלון אינו גלוי או אינו קיים.');
    if (policy.pid !== window.pid) throw new DesktopDriverError('שיוך החלון השתנה.');
    return { policy, processInstance: window.process_instance };
  }
  private sameOwner(a: Pick<Binding, 'policy' | 'processInstance'>, b: Pick<Binding, 'policy' | 'processInstance'>): void {
    if (a.processInstance !== b.processInstance || a.policy.instance !== b.policy.instance || a.policy.bundle !== b.policy.bundle || a.policy.title !== b.policy.title || a.policy.pid !== b.policy.pid || a.policy.windowId !== b.policy.windowId) throw new DesktopDriverError('תוכן החלון או הבעלות השתנו. יש לקרוא אותו מחדש.');
  }
  private invalidate(windowId: number): void { for (const [ref, binding] of this.bindings) if (binding.policy.windowId === windowId) this.bindings.delete(ref); }
  async read(windowId: number, query?: string, signal?: AbortSignal): Promise<DesktopSnapshot> {
    z.number().int().positive().max(4_294_967_295).parse(windowId); z.string().max(120).optional().parse(query);
    if (this.busy.has(windowId)) throw new DesktopDriverError('פעולה כבר מתבצעת בחלון הזה.');
    this.busy.add(windowId);
    try { return await this.snapshot(windowId, query, signal); } finally { this.busy.delete(windowId); }
  }
  private async snapshot(windowId: number, query?: string, signal?: AbortSignal): Promise<DesktopSnapshot> {
    this.invalidate(windowId);
    const owner = await this.owner(windowId, signal);
    const data = z.object({ window: z.object({ id: z.literal(`w-${windowId}`) }), snapshot_id: z.string().regex(/^s[a-z0-9]{1,40}$/), tree: z.unknown(), complete: z.boolean().optional() }).parse(
      await this.call(['snapshot', '--app', owner.policy.app, '--window-id', `w-${windowId}`, '--compact', '--max-depth', '10', '--timeout-ms', '3000'], undefined, signal));
    this.sameOwner(owner, await this.owner(windowId, signal));
    const elements: DesktopElement[] = []; const queue: unknown[] = [data.tree]; let chars = 0, visited = 0, truncated = data.complete === false;
    while (queue.length && visited++ < 2000) {
      const node = nodeSchema.parse(queue.shift());
      if (node.children.length > 200) truncated = true;
      if (node.states.includes('hidden') || node.states.includes('password') || /password|secure/i.test(node.role)) continue;
      queue.push(...node.children.slice(0, 200));
      const value = typeof node.value === 'string' ? node.value : '';
      if (query && !`${node.name} ${value} ${node.role}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue;
      const element: DesktopElement = { ...(node.ref_id ? { ref: node.ref_id } : {}), role: node.role.slice(0, 60), name: node.name.slice(0, 240), value: value.slice(0, 1500), actions: node.available_actions.slice(0, 8), states: node.states.slice(0, 12) };
      if (node.ref_id && !node.ref_id.startsWith(`@${data.snapshot_id}:`)) throw new DesktopDriverError('הפניה אינה שייכת לתצפית.');
      chars += JSON.stringify(element).length;
      if (elements.length === 60 || chars > 12_000) { truncated = true; break; }
      if (value.length > 1500 || node.name.length > 240) truncated = true;
      elements.push(element);
      if (element.ref) this.bindings.set(element.ref, { ...owner, element, time: this.now() });
    }
    if (queue.length) truncated = true;
    while (this.bindings.size > 600) this.bindings.delete(this.bindings.keys().next().value!);
    return { windowId, title: owner.policy.title.slice(0, 300), elements, truncated, observedAt: new Date(this.now()).toISOString(), untrustedContent: true };
  }
  async act(input: DesktopAction, signal?: AbortSignal) {
    z.object({ ref: z.string().regex(REF), action: z.enum(['click', 'fill']), text: z.string().max(2000).optional() }).parse(input);
    const binding = this.bindings.get(input.ref);
    if (!binding || this.now() - binding.time > 60_000) throw new DesktopDriverError('ההפניה ישנה או לא נמסרה לג׳ארוויס. יש לקרוא את החלון מחדש.');
    const id = binding.policy.windowId;
    if (this.busy.has(id)) throw new DesktopDriverError('פעולה כבר מתבצעת בחלון הזה.');
    this.busy.add(id);
    try {
      this.sameOwner(binding, await this.owner(id, signal));
      const verdict = checkDesktopAction(input.action, binding.policy, { allowActions: this.options.allowActions(), element: binding.element, text: input.text });
      if (verdict.level === BLOCK) throw new DesktopDriverError(verdict.reason);
      if (verdict.level === ASK && !await this.options.confirm(`לאשר לחיצה על ״${binding.element.name || binding.element.role}״ בחלון ״${binding.policy.title}״?`, signal)) return { status: 'cancelled', verified: false };
      if (!this.options.allowActions()) throw new DesktopDriverError('פעולות כבויות בהגדרות.');
      this.sameOwner(binding, await this.owner(id, signal));
      if (this.now() - binding.time > 60_000) throw new DesktopDriverError('ההפניה פגה בזמן ההמתנה. יש לקרוא מחדש.');
      this.invalidate(id); // Consume every ref in this window before delivery, including on error.
      const args = input.action === 'fill' ? ['set-value', '--stdin'] : ['click'];
      // --session must precede --; call() appends it only for read commands.
      let result: z.infer<typeof envelope>;
      try { result = envelope.parse(await this.options.run([...args, '--session', this.session, '--timeout-ms', '5000', '--', input.ref], input.action === 'fill' ? input.text : undefined, signal)); }
      catch { return { status: 'unknown', verified: false, note: 'ייתכן שהפעולה נמסרה. אין לחזור עליה אוטומטית; יש לקרוא מחדש.' }; }
      if (!result.ok) return { status: 'unknown', verified: false, note: 'ייתכן שהפעולה נמסרה. אין לחזור עליה אוטומטית; יש לקרוא מחדש.' };
      try { return { status: 'observed', verified: false, note: 'הכלי דיווח על ביצוע; יש לבדוק בתצפית שהושגה התוצאה שהתבקשה.', snapshot: await this.snapshot(id, undefined, signal) }; }
      catch { return { status: 'delivered_unverified', verified: false, note: 'הפעולה דווחה אך קריאת התוצאה נכשלה. אין לבצע שוב אוטומטית.' }; }
    } finally { this.busy.delete(id); }
  }
}

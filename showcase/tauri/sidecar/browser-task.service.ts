import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
// @ts-expect-error Existing app safety module is JavaScript.
import { checkUrl, SAFE } from './safety.mjs';
import type { BrowserPage, BrowserReadInput, BrowserTaskOptions } from './browser-task.types.js';

const OWNER = 'com.ipracticom.roamies.owner'; const JOB = 'com.ipracticom.roamies.job'; const CREATED = 'com.ipracticom.roamies.created';
const LIFE = 300_000;
interface Job { readonly id: string; readonly network: string; readonly proxy: string; readonly browser: string; readonly created: number; readonly abort: AbortController; readonly pending: Set<Promise<string>>; cleanup?: Promise<{ closed: boolean; error?: string }>; timer?: ReturnType<typeof setTimeout>; tab?: string; busy: boolean; steps: number; source: string; state: 'starting' | 'ready' | 'closing' | 'closed' | 'cleanup_failed'; }
const pageSchema = z.object({ source: z.string().max(8000), title: z.string().max(300), text: z.string().max(80_000), links: z.array(z.object({ text: z.string().max(160), url: z.string().max(2000) })).max(20), tables: z.array(z.array(z.array(z.string().max(160)).max(8)).max(12)).max(2) });
export class BrowserTaskError extends Error { override readonly name = 'BrowserTaskError'; }
// Fixed code in the isolated page; never supplied by the model or concatenated with page content.
const PAGE = `JSON.stringify({source:location.href.slice(0,8000),title:document.title.slice(0,300),text:(document.body?.innerText??'').slice(0,80000),links:Array.from(document.querySelectorAll('a[href]')).filter(a=>a.href.startsWith('https://')).slice(0,20).map(a=>({text:(a.innerText||a.getAttribute('aria-label')||'').slice(0,160),url:a.href.slice(0,2000)})),tables:Array.from(document.querySelectorAll('table')).slice(0,2).map(t=>Array.from(t.rows).slice(0,12).map(r=>Array.from(r.cells).slice(0,8).map(c=>c.innerText.slice(0,160))))})`;

export class BrowserTaskService {
  private readonly jobs = new Map<string, Job>();
  private readonly now: () => number;
  private closed = false;
  private preparation?: Promise<void>;
  constructor(private readonly options: BrowserTaskOptions) {
    if (!/^[a-f0-9]{16,64}$/.test(options.ownerId)) throw new BrowserTaskError('invalid owner');
    this.now = options.now ?? Date.now;
  }
  list() { return [...this.jobs.values()].map((job) => ({ jobId: job.id, source: job.source, state: job.state, steps: job.steps, expiresAt: new Date(job.created + LIFE).toISOString() })); }
  private url(value: string): string {
    z.string().min(1).max(8000).parse(value); const url = new URL(value);
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || checkUrl(url.href).level !== SAFE) throw new BrowserTaskError('הדפדפן המבודד תומך כרגע רק באתרי HTTPS ציבוריים בפורט 443.');
    return url.href;
  }
  private async run(job: Job, args: readonly string[], input?: string, signal?: AbortSignal): Promise<string> {
    const combined = signal ? AbortSignal.any([signal, job.abort.signal]) : job.abort.signal;
    combined.throwIfAborted();
    // Let Docker finish resource creation before cleanup. Killing the CLI does not cancel daemon work.
    const mutates = args[0] === 'run' || (args[0] === 'network' && ['create', 'connect'].includes(args[1] ?? ''));
    const pending = this.options.docker(args, input, mutates ? undefined : combined);
    job.pending.add(pending);
    try { const result = await pending; combined.throwIfAborted(); return result; }
    finally { job.pending.delete(pending); }
  }
  private async python(job: Job, code: string, signal?: AbortSignal): Promise<unknown> {
    // Only callers in this module provide code. JSON strings carry all URL/query/tab data.
    return JSON.parse(await this.run(job, ['exec', '-i', job.browser, 'browser-use'], `import json\n${code}`, signal));
  }
  private labels(job: Job): string[] { return ['--label', `${OWNER}=${this.options.ownerId}`, '--label', `${JOB}=${job.id}`, '--label', `${CREATED}=${job.created}`]; }
  async open(urlInput: string, signal?: AbortSignal): Promise<BrowserPage> {
    const source = this.url(urlInput); signal?.throwIfAborted();
    await (this.preparation ??= this.reapEmptyNetworks().catch((error: unknown) => { this.preparation = undefined; throw error; }));
    signal?.throwIfAborted();
    if (this.closed) throw new BrowserTaskError('מנוע הדפדפן נסגר.');
    if ([...this.jobs.values()].filter((job) => job.state !== 'closed').length >= 2) throw new BrowserTaskError('כבר פתוחות שתי משימות דפדפן. יש לסגור אחת לפני פתיחת משימה נוספת.');
    const id = randomUUID(); const network = `roamies-${this.options.ownerId.slice(0,8)}-${id}`;
    const job: Job = { id, network, proxy: `${network}-proxy`, browser: `${network}-browser`, created: this.now(), abort: new AbortController(), pending: new Set(), busy: true, steps: 0, source, state: 'starting' };
    this.jobs.set(id, job); job.timer = setTimeout(() => { void this.close(id); }, LIFE); job.timer.unref();
    try {
      await this.run(job, ['image', 'inspect', 'roamies-browser-use:1.0.4', 'roamies-browser-egress:1', '--format', '{{.Id}}'], undefined, signal);
      await this.run(job, ['network', 'create', '--internal', '--opt', 'com.docker.network.bridge.gateway_mode_ipv4=isolated', ...this.labels(job), network], undefined, signal);
      await this.run(job, ['run', '-d', '--rm', '--pull=never', '--name', job.proxy, ...this.labels(job), '--network', 'bridge', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '--memory', '128m', '--cpus', '1', '-e', `ROAMIES_HOST_SUBNETS=${JSON.stringify(this.options.hostSubnets())}`, 'roamies-browser-egress:1'], undefined, signal);
      await this.run(job, ['network', 'connect', '--alias', 'jarvis-egress', network, job.proxy], undefined, signal);
      for (let attempt = 0; ; attempt++) {
        try { await this.run(job, ['exec', job.proxy, 'node', '-e', 'fetch("http://127.0.0.1:3128/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'], undefined, signal); break; }
        catch (error) { if (attempt === 15 || signal?.aborted || job.abort.signal.aborted) throw error; await delay(250, undefined, { signal: job.abort.signal }); }
      }
      await this.run(job, ['run', '-d', '--rm', '--pull=never', '--name', job.browser, ...this.labels(job), '--network', network, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '--tmpfs', '/tmp:rw,nosuid,size=512m', '--tmpfs', '/home/browser:rw,nosuid,uid=1000,gid=1000,size=128m', '--memory', '1g', '--cpus', '2', 'roamies-browser-use:1.0.4', 'timeout', '300', 'chromium', '--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9222', '--user-data-dir=/tmp/profile', '--no-first-run', '--no-default-browser-check', '--proxy-server=http://jarvis-egress:3128', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE jarvis-egress', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', 'about:blank'], undefined, signal);
      for (let attempt = 0; ; attempt++) {
        try { await this.python(job, 'print(json.dumps(page_info()))', signal); break; }
        catch (error) { if (attempt === 9 || signal?.aborted || job.abort.signal.aborted) throw error; await delay(200, undefined, { signal: job.abort.signal }); }
      }
      const tab = z.object({ targetId: z.string().regex(/^[A-Fa-f\d]{16,64}$/) }).parse(await this.python(job, `p=json.loads(${JSON.stringify(JSON.stringify({ url: source }))})\nnew_tab(p['url'])\nprint(json.dumps(current_tab()))`, signal));
      job.tab = tab.targetId; job.state = 'ready'; return await this.snapshot(job, {}, signal);
    } catch (error) { await this.close(id); throw error; }
    finally { job.busy = false; }
  }
  private async snapshot(job: Job, input: Omit<BrowserReadInput, 'jobId'>, signal?: AbortSignal): Promise<BrowserPage> {
    if (!job.tab || job.state !== 'ready' || this.now() >= job.created + LIFE || ++job.steps > 20) throw new BrowserTaskError('המשימה הסתיימה או הגיעה לתקציב הקריאות שלה.');
    const data = { tab: job.tab, code: PAGE };
    const raw = await this.python(job, `p=json.loads(${JSON.stringify(JSON.stringify(data))})\nswitch_tab(p['tab'])\nprint(js(p['code']))`, signal);
    const page = pageSchema.parse(raw); job.source = this.url(page.source);
    let offset = input.offset ?? 0; let queryFound: boolean | undefined;
    if (input.query) { const at = page.text.toLocaleLowerCase().indexOf(input.query.toLocaleLowerCase()); queryFound = at >= 0; if (at >= 0) offset = Math.max(0, at - 300); }
    const text = page.text.slice(offset, offset + 5000);
    return { jobId: job.id, source: job.source, title: page.title, text, ...(queryFound === undefined ? {} : { queryFound }), ...(offset + text.length < page.text.length ? { nextOffset: offset + text.length } : {}), truncated: page.text.length >= 80_000, links: page.links.filter((link) => checkUrl(link.url).level === SAFE && link.url.length <= 1000).slice(0, 10).map((link) => ({ text: link.text.slice(0, 100), url: link.url })), tables: page.tables.slice(0, 1).map((table) => table.slice(0, 6).map((row) => row.slice(0, 5).map((cell) => cell.slice(0, 80)))), observedAt: new Date(this.now()).toISOString(), expiresAt: new Date(job.created + LIFE).toISOString(), untrustedContent: true };
  }
  async read(input: BrowserReadInput, signal?: AbortSignal): Promise<BrowserPage> {
    z.object({ jobId: z.uuid(), query: z.string().max(200).optional(), offset: z.number().int().min(0).max(80_000).optional() }).parse(input);
    const job = this.jobs.get(input.jobId); if (!job || job.state !== 'ready') throw new BrowserTaskError('משימת הדפדפן אינה פעילה. יש לפתוח משימה חדשה.');
    if (job.busy) throw new BrowserTaskError('קריאה כבר מתבצעת במשימה הזאת.'); job.busy = true;
    try { return await this.snapshot(job, input, signal); } catch (error) { await this.close(job.id); throw error; } finally { job.busy = false; }
  }
  private async removeOwned(job: Job, kind: 'container' | 'network', name: string): Promise<void> {
    let records: unknown;
    try { records = JSON.parse(await this.options.docker([kind, 'inspect', name])); }
    catch {
      // Distinguish already auto-removed resources from a daemon that is unreachable.
      const ids = await this.options.docker([kind, 'ls', ...(kind === 'container' ? ['-a'] : []), '-q', '--filter', `label=${JOB}=${job.id}`, '--filter', `label=${OWNER}=${this.options.ownerId}`, '--filter', `name=^${kind === 'container' ? '/' : ''}${name}$`]);
      if (ids) throw new BrowserTaskError('ניקוי סביבת הדפדפן טרם הושלם.'); return;
    }
    const row = z.array(z.object({ Id: z.string().regex(/^[a-f\d]{64}$/), Config: z.object({ Labels: z.record(z.string(), z.string()).nullable() }).optional(), Labels: z.record(z.string(), z.string()).nullable().optional() })).length(1).parse(records)[0];
    const labels = kind === 'container' ? row.Config?.Labels : row.Labels;
    if (labels?.[JOB] !== job.id || labels?.[OWNER] !== this.options.ownerId) throw new BrowserTaskError('המשאב אינו שייך למשימה; הוא לא הוסר.');
    await this.options.docker([kind, 'rm', ...(kind === 'container' ? ['-f'] : []), row.Id]);
  }
  async close(jobId: string) {
    z.uuid().parse(jobId); const job = this.jobs.get(jobId);
    if (!job || job.state === 'closed') return { closed: true };
    if (job.cleanup) return job.cleanup;
    job.state = 'closing'; job.abort.abort(); clearTimeout(job.timer);
    job.cleanup = this.cleanup(job);
    try { return await job.cleanup; } finally { job.cleanup = undefined; }
  }
  private async cleanup(job: Job): Promise<{ closed: boolean; error?: string }> {
    await Promise.allSettled([...job.pending]);
    const result = await Promise.allSettled([this.removeOwned(job, 'container', job.browser), this.removeOwned(job, 'container', job.proxy)]);
    const containersRemoved = result.every((entry) => entry.status === 'fulfilled');
    const networkRemoved = containersRemoved && await this.removeOwned(job, 'network', job.network).then(() => true, () => false);
    job.state = networkRemoved ? 'closed' : 'cleanup_failed';
    // Retain a short history so the model can distinguish closed from interrupted cleanup.
    const old = [...this.jobs.values()].filter((entry) => entry.state === 'closed'); for (const entry of old.slice(0, Math.max(0, old.length - 8))) this.jobs.delete(entry.id);
    return { closed: networkRemoved, ...(networkRemoved ? {} : { error: 'ניקוי המשימה לא הושלם; המכולות מוגבלות לחמש דקות ויש לנסות סגירה שוב לאחר חזרת Docker.' }) };
  }
  private async reapEmptyNetworks(): Promise<void> {
    const ids = (await this.options.docker(['network', 'ls', '-q', '--no-trunc', '--filter', `label=${OWNER}=${this.options.ownerId}`])).split(/\s+/).filter(Boolean);
    if (ids.length > 64) throw new BrowserTaskError('נדרש ניקוי רשתות דפדפן לפני פתיחת משימה חדשה.');
    for (const id of ids) {
      if (!/^[a-f\d]{64}$/.test(id)) throw new BrowserTaskError('מזהה רשת לא תקין.');
      const rows = z.array(z.object({ Id: z.string(), Labels: z.record(z.string(), z.string()), Containers: z.record(z.string(), z.unknown()) })).length(1).parse(JSON.parse(await this.options.docker(['network', 'inspect', id])));
      const row = rows[0]; const created = Number(row.Labels[CREATED]);
      if (row.Id === id && row.Labels[OWNER] === this.options.ownerId && z.uuid().safeParse(row.Labels[JOB]).success && Number.isFinite(created) && created > 0 && this.now() - created > 2 * LIFE && Object.keys(row.Containers).length === 0) {
        // No force: Docker refuses removal if another container attached in the meantime.
        await this.options.docker(['network', 'rm', id]);
      }
    }
  }
  async closeAll(): Promise<void> { this.closed = true; await Promise.allSettled([...this.jobs.keys()].map((id) => this.close(id))); }
}

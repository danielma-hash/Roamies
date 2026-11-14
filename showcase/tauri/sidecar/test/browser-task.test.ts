import { expect, it } from 'vitest';
import { BrowserTaskService } from '../browser-task.service.js';
import { createBrowserTools } from '../browser-tools.js';

const OWNER = 'com.ipracticom.roamies.owner'; const JOB = 'com.ipracticom.roamies.job';
function fixture() {
  const calls: { args: readonly string[]; input?: string }[] = [];
  const resources = new Map<string, { Id: string; Labels: Record<string, string>; Config: { Labels: Record<string, string> } }>();
  let serial = 0; let beforeRun: (() => Promise<void>) | undefined; let failRead = false; let foreign = false;
  const docker = async (args: readonly string[], input?: string): Promise<string> => {
    calls.push({ args, input });
    if (args[1] === 'ls') return '';
    if (args[0] === 'image') return 'images';
    if (args[0] === 'run' || (args[0] === 'network' && args[1] === 'create')) {
      if (args[0] === 'run') await beforeRun?.();
      const name = args[0] === 'run' ? args[args.indexOf('--name') + 1] : args.at(-1)!;
      const Labels: Record<string, string> = {};
      args.forEach((arg, i) => { if (arg === '--label') { const value = args[i + 1]; const at = value.indexOf('='); Labels[value.slice(0, at)] = value.slice(at + 1); } });
      const Id = (++serial).toString(16).padStart(64, '0'); resources.set(name, { Id, Labels, Config: { Labels } }); return Id;
    }
    if (args[1] === 'inspect') {
      const row = resources.get(args[2]); if (!row) throw new Error('absent');
      return JSON.stringify([{ ...row, ...(foreign ? { Config: { Labels: { [OWNER]: 'other' } }, Labels: { [OWNER]: 'other' } } : {}) }]);
    }
    if (args[1] === 'rm') { for (const [name, row] of resources) if (row.Id === args.at(-1)) resources.delete(name); return ''; }
    if (input?.includes('current_tab')) return JSON.stringify({ targetId: 'A'.repeat(32) });
    if (input?.includes('switch_tab')) {
      if (failRead) throw new Error('lost response');
      return JSON.stringify({ source: 'https://example.com/', title: 'דף בדיקה', text: 'שלום Jarvis '+ 'x'.repeat(7000), links: [{text:'local',url:'https://127.0.0.1'}, {text:'source',url:'https://example.org'}], tables: [] });
    }
    return '{}';
  };
  const browser = new BrowserTaskService({ docker, ownerId: 'a'.repeat(16), hostSubnets: () => ['127.0.0.1/8'] });
  return { browser, calls, resources, pause: (callback: () => Promise<void>) => { beforeRun = callback; }, fail: () => { failRead = true; }, foreign: () => { foreign = true; } };
}
it('bounds content, filters private links, supports query and returns string tool results', async () => {
  const f = fixture();
  try {
    const tools = createBrowserTools(f.browser);
    const page = JSON.parse(await tools[0].execute({ url: 'https://example.com' }));
    expect(page.text.length).toBe(5000); expect(page.nextOffset).toBe(5000); expect(page.untrustedContent).toBe(true);
    expect(page.links).toEqual([{ text: 'source', url: 'https://example.org' }]);
    expect(await f.browser.read({ jobId: page.jobId, query: 'Jarvis' })).toMatchObject({ queryFound: true });
    expect(JSON.parse(await tools[2].execute())).toHaveLength(1);
    expect(JSON.parse(await tools[3].execute({ jobId: page.jobId }))).toEqual({ closed: true });
    expect(f.resources.size).toBe(0);
  } finally { await f.browser.closeAll(); }
});
it('refuses local and non-HTTPS URLs before Docker and limits active tasks', async () => {
  const f = fixture();
  for (const url of ['http://example.com','https://127.0.0.1','file:///etc/passwd','https://example.com:8443']) await expect(f.browser.open(url)).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
  try {
    await f.browser.open('https://example.com'); await f.browser.open('https://example.org');
    await expect(f.browser.open('https://example.net')).rejects.toThrow('שתי');
  } finally { await f.browser.closeAll(); }
  expect(f.resources.size).toBe(0);
});
it('waits for resource creation on cancellation and cleans only verified IDs', async () => {
  const f = fixture(); let release!: () => void; let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  f.pause(() => { started(); return new Promise<void>((resolve) => { release = resolve; }); });
  const opening = f.browser.open('https://example.com'); const rejected = expect(opening).rejects.toThrow();
  await entered;
  const closing = f.browser.close(f.browser.list()[0].jobId);
  expect(f.calls.some(({ args }) => args[1] === 'rm')).toBe(false);
  release(); await rejected; expect(await closing).toEqual({ closed: true }); expect(f.resources.size).toBe(0);
  expect(f.calls.filter(({ args }) => args[1] === 'rm').every(({ args }) => /^[a-f0-9]{64}$/.test(args.at(-1)!))).toBe(true);
});
it('never deletes a resource with another owner label and reports incomplete cleanup', async () => {
  const f = fixture(); const page = await f.browser.open('https://example.com'); f.foreign();
  expect(await f.browser.close(page.jobId)).toMatchObject({ closed: false });
  expect(f.calls.some(({ args }) => args[1] === 'rm')).toBe(false);
});
it('closes on read failure instead of retrying the persistent REPL', async () => {
  const f = fixture(); const page = await f.browser.open('https://example.com'); f.fail();
  await expect(f.browser.read({ jobId: page.jobId })).rejects.toThrow('lost response');
  expect(f.resources.size).toBe(0); expect(f.browser.list()[0].state).toBe('closed');
});
it('keeps model input as data and never mounts host files or exposes a port', async () => {
  const f = fixture();
  try {
    await f.browser.open('https://example.com/?q=%27%29%3Bprint%28%22injected%22%29');
    const scripts = f.calls.filter((call) => call.input).map((call) => call.input!);
    expect(scripts.some((script) => script.includes('p=json.loads('))).toBe(true);
    const runs = f.calls.filter(({args}) => args[0] === 'run'); expect(runs).toHaveLength(2);
    for (const { args } of runs) { expect(args).toContain('--read-only'); expect(args).toContain('--pull=never'); expect(args).not.toContain('-v'); expect(args).not.toContain('-p'); }
    expect(runs[1].args).toContain('timeout'); expect(runs[1].args).toContain('300');
  } finally { await f.browser.closeAll(); }
});
it('stops after twenty reads and refuses further operations', async () => {
  const f = fixture(); const page = await f.browser.open('https://example.com');
  for (let i = 1; i < 20; i++) await f.browser.read({ jobId: page.jobId });
  await expect(f.browser.read({ jobId: page.jobId })).rejects.toThrow('תקציב');
  expect(f.resources.size).toBe(0);
});
it('reaps only old empty networks owned by this profile', async () => {
  const id = 'b'.repeat(64); const removed: string[] = []; let inspected = 0;
  const browser = new BrowserTaskService({ ownerId: 'a'.repeat(16), hostSubnets: () => [], now: () => 1_000_000,
    docker: async (args) => {
      if (args[1] === 'ls') return id;
      if (args[1] === 'inspect' && args[0] === 'network') { inspected++; return JSON.stringify([{ Id: id, Labels: { [OWNER]: 'a'.repeat(16), [JOB]: 'e9c1be1c-5d1b-4b87-bf26-0539a9a66f54', 'com.ipracticom.roamies.created': '1000' }, Containers: {} }]); }
      if (args[1] === 'rm') { removed.push(args.at(-1)!); return ''; }
      throw new Error('images unavailable');
    } });
  await expect(browser.open('https://example.com')).rejects.toThrow('images unavailable');
  expect(inspected).toBe(1); expect(removed).toEqual([id]);
});

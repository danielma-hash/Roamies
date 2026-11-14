import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { parseWebDocument } from '../web-document.js';

// Explicit opt-in: no Docker startup, image download or external account in normal npm test.
// This is a permanent regression fixture, never a page exposed to a user or a model.
const fixture = `<!doctype html><html dir="rtl" lang="he"><meta charset="utf-8">
<title>Jarvis runtime validation</title><h1>מרכז הבדיקה</h1><p>מחיר קבוע: 42</p>
<div id="dynamic"></div><table><tr><th>שם</th><th>מחיר</th></tr><tr><td>בדיקה</td><td>42</td></tr></table>
<form id="form"><label>שם<input id="name" aria-label="שם"></label><button>שמור</button></form><output id="result"></output>
<script>document.querySelector('#dynamic').textContent='נתון דינמי: 73';
document.querySelector('#form').onsubmit=e=>{e.preventDefault();document.querySelector('#result').textContent='נשמר: '+document.querySelector('#name').value;};</script></html>`;

function docker(args: readonly string[], input?: string, timeout = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', [...args], { timeout, maxBuffer: 256_000, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) reject(new Error(`Docker validation failed: ${error.message}; ${stderr.slice(0, 500)}`));
      else resolve(stdout.trim());
    });
    child.stdin?.on('error', () => { /* callback reports early process exit */ });
    child.stdin?.end(input);
  });
}

it.skipIf(process.env.ROAMIES_BROWSER_LIVE !== '1')('validates Browser Use isolation, DOM actions, stale nodes and cancellation', async () => {
  const name = `roamies-browser-test-${randomUUID()}`;
  const run = (code: string) => docker(['exec', '-i', name, 'browser-use'], code);
  const json = (code: string): Promise<unknown> => run(`import json\nprint(json.dumps(${code},ensure_ascii=False))`).then((value) => JSON.parse(value));
  let created = false;
  try {
    await docker(['run', '-d', '--pull=never', '--name', name, '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '--tmpfs', '/tmp:rw,nosuid,size=512m', '--tmpfs', '/home/browser:rw,nosuid,uid=1000,gid=1000,size=128m', '--memory', '1g', '--cpus', '2', 'roamies-browser-use:1.0.4']);
    created = true;
    const info: unknown = JSON.parse(await docker(['inspect', name]));
    expect(info).toMatchObject([{ Config: { User: 'browser' }, HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, CapDrop: ['ALL'], Binds: null, PortBindings: {}, Privileged: false } }]);
    const boundary = await docker(['exec', '-i', name, 'python', '-'], `import json, socket, os
blocked=[]
for host in ['1.1.1.1', 'host.docker.internal']:
 try:
  socket.create_connection((host,443),timeout=1).close()
  blocked.append(False)
 except OSError: blocked.append(True)
print(json.dumps({'blocked':blocked,'uid':os.getuid(),'host_home':os.path.exists('/Users'),'docker_socket':os.path.exists('/var/run/docker.sock'),'keys':any(k in os.environ for k in ['OPENAI_API_KEY','BROWSER_USE_API_KEY','ANTHROPIC_API_KEY'])}))`);
    expect(JSON.parse(boundary)).toEqual({ blocked: [true, true], uid: 1000, host_home: false, docker_socket: false, keys: false });
    await docker(['exec', '-i', name, 'python', '-c', 'import sys;open("/tmp/fixture.html","w").write(sys.stdin.read())'], fixture);
    await docker(['exec', '-d', name, 'python', '-m', 'http.server', '8080', '--bind', '127.0.0.1', '--directory', '/tmp']);
    // Poll only read-only readiness. Never retry a possibly delivered action.
    for (let attempt = 0; ; attempt++) {
      try { await run('print(page_info())'); break; }
      catch (error) { if (attempt === 9) throw error; await delay(300); }
    }
    await run("new_tab('http://127.0.0.1:8080/fixture.html')");
    const samples: { path: string; elapsedMs: number; bytes: number }[] = [];
    // Same fixture, three extraction paths. Timings include the CLI for browser paths,
    // but only local parsing for the inert reader: this is not an HTTP/LLM cost benchmark.
    for (let repeat = 0; repeat < 3; repeat++) {
      let start = performance.now(); const inert = parseWebDocument(fixture, true);
      samples.push({ path: 'inert-parser', elapsedMs: performance.now() - start, bytes: Buffer.byteLength(JSON.stringify(inert)) });
      expect(inert.text).toContain('מחיר קבוע: 42'); expect(inert.text).not.toContain('נתון דינמי: 73');
      start = performance.now(); const focused = await json("{'text':js('document.body.innerText')[:8000]}");
      samples.push({ path: 'focused-dom', elapsedMs: performance.now() - start, bytes: Buffer.byteLength(JSON.stringify(focused)) });
      expect(focused).toMatchObject({ text: expect.stringContaining('נתון דינמי: 73') });
      start = performance.now(); const tree = await json("cdp('Accessibility.getFullAXTree')");
      samples.push({ path: 'full-ax-tree', elapsedMs: performance.now() - start, bytes: Buffer.byteLength(JSON.stringify(tree)) });
    }
    await run(`nodes=cdp('Accessibility.getFullAXTree')['nodes']
field=next(n['backendDOMNodeId'] for n in nodes if n.get('role',{}).get('value')=='textbox' and n.get('name',{}).get('value')=='שם')
button=next(n['backendDOMNodeId'] for n in nodes if n.get('role',{}).get('value')=='button' and n.get('name',{}).get('value')=='שמור')
cdp('DOM.focus',backendNodeId=field)
cdp('Input.insertText',text='Jarvis בעברית')
box=cdp('DOM.getBoxModel',backendNodeId=button)['model']['content']
click_at_xy((box[0]+box[4])/2,(box[1]+box[5])/2)`);
    expect(await json(`js('document.querySelector("#result").textContent')`)).toBe('נשמר: Jarvis בעברית');
    await run(`cdp('Network.setCookie',name='fixture_auth',value='synthetic-only',url='http://127.0.0.1:8080',httpOnly=True)`);
    const cookies = await json(`cdp('Network.getCookies',urls=['http://127.0.0.1:8080'])`);
    expect(cookies).toMatchObject({ cookies: [expect.objectContaining({ name: 'fixture_auth', value: 'synthetic-only' })] });
    const before = await json("cdp('Page.getFrameTree')['frameTree']['frame']['loaderId']");
    await run("cdp('Page.navigate',url='http://127.0.0.1:8080/fixture.html?new=1')");
    let after: unknown = before;
    for (let attempt = 0; attempt < 20 && after === before; attempt++) { await delay(50); after = await json("cdp('Page.getFrameTree')['frameTree']['frame']['loaderId']"); }
    expect(after).not.toBe(before);
    const stale = await run(`try:
 cdp('DOM.getBoxModel',backendNodeId=button)
 print('STALE_ACCEPTED')
except Exception:
 print('STALE_REJECTED')`);
    expect(stale).toContain('STALE_REJECTED');
    console.log(JSON.stringify({ browserUse: '1.0.4', harness: '0.1.13', samples, tokens: 'not measured', modelCost: 'no model invoked; no claim about subscription cost', auth: 'synthetic cookie only; real account not tested' }));
    // Stop the whole owned runtime, not just the client: a persistent REPL may continue
    // executing after a CLI timeout. No other container or user's browser is stopped.
    const pending = run('import time\nopen("/tmp/cancel-started","w").write("started")\ntime.sleep(30)');
    const result = pending.then(() => 'completed', () => 'cancelled');
    for (let attempt = 0; ; attempt++) {
      try { await docker(['exec', name, 'test', '-f', '/tmp/cancel-started']); break; }
      catch (error) { if (attempt === 19) throw error; await delay(50); }
    }
    await docker(['stop', '--time', '1', name]);
    expect(await result).toBe('cancelled');
    expect(await docker(['inspect', '--format', '{{.State.Running}}', name])).toBe('false');
  } finally { if (created) await docker(['rm', '-f', name]); }
}, 120_000);

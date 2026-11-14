import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';

function docker(args: readonly string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = execFile('docker', [...args], { timeout: 20_000, maxBuffer: 256_000, encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
    process.stdin?.on('error', () => {}); process.stdin?.end(input);
  });
}
it.skipIf(process.env.ROAMIES_BROWSER_LIVE !== '1')('opens real HTTPS through the proxy while direct/private/host/CDP bypasses fail', async () => {
  const network = `roamies-egress-test-${randomUUID()}`; const proxy = `${network}-proxy`; const browser = `${network}-browser`;
  let madeNetwork = false, madeProxy = false, madeBrowser = false;
  try {
    await docker(['network', 'create', '--internal', '--opt', 'com.docker.network.bridge.gateway_mode_ipv4=isolated', network]); madeNetwork = true;
    const subnets = Object.values(networkInterfaces()).flatMap((values) => values ?? []).filter((value) => value.family === 'IPv4').map((value) => value.cidr ?? `${value.address}/32`);
    await docker(['run', '-d', '--pull=never', '--name', proxy, '--network', 'bridge', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '--memory', '128m', '--cpus', '1', '-e', `ROAMIES_HOST_SUBNETS=${JSON.stringify(subnets)}`, 'roamies-browser-egress:1']); madeProxy = true;
    await docker(['network', 'connect', '--alias', 'jarvis-egress', network, proxy]);
    for (let attempt = 0; ; attempt++) {
      try { expect(await docker(['exec', proxy, 'node', '-e', 'fetch("http://127.0.0.1:3128/health").then(async r=>{if(!r.ok)process.exit(1);console.log(await r.text())}).catch(()=>process.exit(1))'])).toBe('ready'); break; }
      catch (error) { if (attempt === 19) throw error; await delay(250); }
    }
    await docker(['run', '-d', '--pull=never', '--name', browser, '--network', network, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '--tmpfs', '/tmp:rw,nosuid,size=512m', '--tmpfs', '/home/browser:rw,nosuid,uid=1000,gid=1000,size=128m', '--memory', '1g', '--cpus', '2', 'roamies-browser-use:1.0.4', 'chromium', '--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9222', '--user-data-dir=/tmp/profile', '--no-first-run', '--no-default-browser-check', '--proxy-server=http://jarvis-egress:3128', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE jarvis-egress', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', 'about:blank']); madeBrowser = true;
    const configuration: unknown = JSON.parse(await docker(['inspect', browser]));
    expect(configuration).toMatchObject([{ Config: { User: 'browser' }, HostConfig: { NetworkMode: network, ReadonlyRootfs: true, CapDrop: ['ALL'], Binds: null, PortBindings: {}, Privileged: false } }]);
    expect(JSON.parse(await docker(['network', 'inspect', network]))).toMatchObject([{ Internal: true, EnableIPv6: false, Options: { 'com.docker.network.bridge.gateway_mode_ipv4': 'isolated' } }]);
    const run = (code: string) => docker(['exec', '-i', browser, 'browser-use'], code);
    for (let attempt = 0; ; attempt++) { try { await run('print(page_info())'); break; } catch (error) { if (attempt === 9) throw error; await delay(200); } }
    const page = JSON.parse(await run("import json\nnew_tab('https://example.com')\nprint(json.dumps({'title':page_info()['title'],'text':js('document.body.innerText')[:500]}))"));
    expect(page.title).toBe('Example Domain'); expect(page.text.length).toBeGreaterThan(20);
    const boundaries: unknown = JSON.parse(await docker(['exec', '-i', browser, 'python', '-'], `import socket,json
direct=[]
for host in ['1.1.1.1','host.docker.internal','169.254.169.254','172.17.0.1']:
 try:
  socket.create_connection((host,443),timeout=1).close();direct.append(False)
 except OSError: direct.append(True)
blocked=[]
for host in ['127.0.0.1','169.254.169.254','10.0.0.1','host.docker.internal','127.0.0.1.nip.io']:
 s=socket.create_connection(('jarvis-egress',3128),timeout=5)
 s.sendall(('CONNECT '+host+':443 HTTP/1.1\\r\\nHost: '+host+':443\\r\\n\\r\\n').encode())
 blocked.append(s.recv(100).decode().startswith('HTTP/1.1 403'));s.close()
print(json.dumps({'direct':direct,'proxy':blocked}))`));
    expect(boundaries).toEqual({ direct: [true,true,true,true], proxy: [true,true,true,true,true] });
    await run("cdp('Page.navigate',url='http://127.0.0.1:9222/json/version')");
    expect(JSON.parse(await run("print(json.dumps(js('document.body.innerText')))"))).toBe('HTTPS CONNECT required');
    // No public address is logged; verify the NAT exclusion from the same egress namespace.
    expect(await docker(['exec', '-i', proxy, 'node', '--input-type=module', '-'], `import {connect} from 'node:net';
const ip=(await (await fetch('https://api.ipify.org',{signal:AbortSignal.timeout(5000)})).text()).trim();
const socket=connect(3128,'127.0.0.1');socket.setTimeout(5000,()=>process.exit(1));
socket.on('connect',()=>socket.write('CONNECT '+ip+':443 HTTP/1.1\\r\\nHost: '+ip+':443\\r\\n\\r\\n'));
socket.on('data',d=>{if(!d.toString().startsWith('HTTP/1.1 403'))process.exit(1);console.log('home address blocked');socket.destroy()});`)).toBe('home address blocked');
  } finally {
    if (madeBrowser) await docker(['rm', '-f', browser]);
    if (madeProxy) await docker(['rm', '-f', proxy]);
    if (madeNetwork) await docker(['network', 'rm', network]);
  }
}, 120_000);

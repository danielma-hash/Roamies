import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { BrowserTaskService } from '../browser-task.service.js';
import { localDockerProcess } from '../docker-process.service.js';
import { createBrowserTools } from '../browser-tools.js';
it.skipIf(process.env.ROAMIES_BROWSER_LIVE !== '1')('reads a real HTTPS page through registered tools and removes all owned resources', async () => {
  const docker = localDockerProcess(); if (!docker) throw new Error('Local Docker unavailable');
  const ownerId = randomBytes(16).toString('hex');
  const browser = new BrowserTaskService({ docker: (args, input, signal) => docker.run(args, input, signal), ownerId,
    hostSubnets: () => Object.values(networkInterfaces()).flatMap((values) => values ?? []).filter((value) => value.family === 'IPv4').map((value) => value.cidr ?? `${value.address}/32`) });
  try {
    const tools = createBrowserTools(browser);
    const page = JSON.parse(await tools[0].execute({ url: 'https://example.com' }));
    expect(page.title).toBe('Example Domain'); expect(page.text).toContain('documentation');
    expect(JSON.parse(await tools[1].execute({ jobId: page.jobId, query: 'documentation' }))).toMatchObject({ queryFound: true });
    expect(JSON.parse(await tools[3].execute({ jobId: page.jobId }))).toEqual({ closed: true });
    expect(await docker.run(['container', 'ls', '-aq', '--filter', `label=com.ipracticom.roamies.owner=${ownerId}`])).toBe('');
    expect(await docker.run(['network', 'ls', '-q', '--filter', `label=com.ipracticom.roamies.owner=${ownerId}`])).toBe('');
  } finally { await browser.closeAll(); }
}, 120_000);

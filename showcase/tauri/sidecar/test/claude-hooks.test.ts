import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeHooksService } from '../claude-hooks.service.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function setup(initial?: string): Promise<{ settingsPath: string; service: ClaudeHooksService }> {
  const directory = await mkdtemp(join(tmpdir(), 'claude-hooks-')); directories.push(directory);
  const settingsPath = join(directory, 'settings.json');
  if (initial !== undefined) await writeFile(settingsPath, initial);
  return { settingsPath, service: new ClaudeHooksService({ settingsPath, nodePath: '/usr/local/bin/node', scriptPath: "/Applications/Roamies user's/claude-events.mjs" }) };
}

describe('Claude hook installation', () => {
  it('preserves all unrelated settings and hooks, backs up exact bytes, and is idempotent', async () => {
    const previous = { permissions: { allow: ['Read'] }, env: { EXISTING: 'preserved' }, hooks: {
      Stop: [{ matcher: 'custom', hooks: [{ type: 'command', command: 'my-existing-hook', timeout: 20 }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'security-check' }] }],
    } };
    const raw = JSON.stringify(previous);
    const { service, settingsPath } = await setup(raw);
    expect((await service.status()).installed).toBe(false);
    const result = await service.install();
    expect(result).toMatchObject({ installed: true, changed: true, configuredEvents: 6, totalEvents: 6 });
    expect(await readFile(result.backupPath!, 'utf8')).toBe(raw);
    expect((await stat(result.backupPath!)).mode & 0o777).toBe(0o600);
    expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);
    const installed = JSON.parse(await readFile(settingsPath, 'utf8')) as typeof previous;
    expect(installed.permissions).toEqual(previous.permissions); expect(installed.env).toEqual(previous.env);
    expect(installed.hooks.PreToolUse).toEqual(previous.hooks.PreToolUse);
    expect(installed.hooks.Stop[0]).toEqual(previous.hooks.Stop[0]);
    expect(installed.hooks.Stop[1].hooks[0].command).toContain("'/Applications/Roamies user'\\''s/claude-events.mjs'");
    const before = await readFile(settingsPath, 'utf8');
    expect(await service.install()).toMatchObject({ installed: true, changed: false });
    expect(await readFile(settingsPath, 'utf8')).toBe(before);
    expect((await readdir(join(settingsPath, '..'))).filter((name) => name.includes('backup'))).toHaveLength(1);
  });

  it('creates a new private config without a spurious backup', async () => {
    const { service } = await setup();
    expect(await service.install()).toEqual({ installed: true, configuredEvents: 6, totalEvents: 6, changed: true });
  });

  it('does not overwrite invalid settings or enable globally disabled hooks', async () => {
    for (const raw of ['{broken', '[]', '{"hooks": []}', '{"hooks":{"Stop":{}}}', '{"disableAllHooks":true}']) {
      const { service, settingsPath } = await setup(raw);
      await expect(service.install()).rejects.toThrow();
      expect(await readFile(settingsPath, 'utf8')).toBe(raw);
    }
  });

  it('detects an external edit before replacement and leaves that edit intact', async () => {
    const { settingsPath } = await setup('{"existing":true}');
    const external = '{"externalEdit":true}';
    const service = new ClaudeHooksService({ settingsPath, nodePath: '/usr/bin/node', scriptPath: '/app/events.mjs', beforeCommit: async () => { await writeFile(settingsPath, external); } });
    await expect(service.install()).rejects.toThrow('השתנו במקביל');
    expect(await readFile(settingsPath, 'utf8')).toBe(external);
    expect(await readdir(join(settingsPath, '..'))).toEqual(['settings.json']);
  });

  it('updates only our observer when the app path changes and retains its neighboring hook', async () => {
    const { service, settingsPath } = await setup();
    await service.install();
    const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as { hooks: Record<string, { hooks: { type: string; command: string }[] }[]> };
    settings.hooks.Stop[0].hooks.push({ type: 'command', command: 'neighbor-preserved' });
    await writeFile(settingsPath, JSON.stringify(settings));
    const replacement = new ClaudeHooksService({ settingsPath, nodePath: '/usr/bin/node', scriptPath: '/new-app/events.mjs' });
    await replacement.install();
    const updated = JSON.parse(await readFile(settingsPath, 'utf8')) as typeof settings;
    const commands = updated.hooks.Stop.flatMap((entry) => entry.hooks.map((hook) => hook.command));
    expect(commands).toHaveLength(2); expect(commands[0]).toBe('neighbor-preserved'); expect(commands[1]).toContain('/new-app/events.mjs');
  });

  it('does not remove an existing install lock or accept shell line injection', async () => {
    const { service, settingsPath } = await setup('{}');
    const lock = `${settingsPath}.roamies.lock`; await writeFile(lock, 'another process');
    await expect(service.install()).rejects.toThrow('כבר מתבצע');
    expect(await readFile(lock, 'utf8')).toBe('another process');
    expect(() => new ClaudeHooksService({ nodePath: '/bin/node\nmalicious', scriptPath: '/app/events.mjs' })).toThrow('נתיבים');
  });
});

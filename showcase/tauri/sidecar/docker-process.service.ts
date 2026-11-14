import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

export class DockerProcessError extends Error { override readonly name = 'DockerProcessError'; }
/** Uses only a local socket; ambient DOCKER_HOST/CONTEXT and credentials are not forwarded. */
export class DockerProcessService {
  constructor(private readonly binary: string, private readonly socket: string) {}
  run(args: readonly string[], input?: string, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(this.binary, ['--host', `unix://${this.socket}`, ...args], { timeout: 20_000, maxBuffer: 512_000, encoding: 'utf8', signal,
        env: { HOME: homedir(), TMPDIR: tmpdir(), PATH: '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin' } },
      (error, stdout) => error ? reject(new DockerProcessError('סביבת הדפדפן לא השלימה את הפעולה. יש לוודא ש־Docker פועל ושהרכיבים המבודדים מותקנים.')) : resolve(stdout.trim()));
      child.stdin?.on('error', () => {}); child.stdin?.end(input);
    });
  }
}
export function localDockerProcess(): DockerProcessService | undefined {
  const binary = ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', '/usr/bin/docker'].find(existsSync);
  const socket = [path.join(homedir(), '.docker/run/docker.sock'), '/var/run/docker.sock'].find((value) => { try { return statSync(value).isSocket(); } catch { return false; } });
  return binary && socket ? new DockerProcessService(binary, socket) : undefined;
}

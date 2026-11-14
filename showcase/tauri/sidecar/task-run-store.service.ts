import { constants } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { taskRunArchiveSchema } from './task-run.schema.js';
import type { TaskRunArchive } from './task-run.types.js';
import { TaskRunError } from './task-run-error.js';
const MAX_BYTES = 8 * 1024 * 1024;

/** One owning sidecar per profile. Atomic checkpoints; no executable state is restored. */
export class TaskRunStoreService {
  constructor(private readonly file: string) {}
  async load(): Promise<TaskRunArchive> {
    try {
      const handle = await open(this.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_BYTES) throw new TaskRunError();
        const buffer = Buffer.alloc(stat.size + 1); let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
          if (!bytesRead) break; offset += bytesRead;
        }
        if (offset !== stat.size) throw new TaskRunError();
        return taskRunArchiveSchema.parse(JSON.parse(buffer.toString('utf8', 0, offset)));
      } finally { await handle.close(); }
    } catch (error: unknown) {
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { version: 1, runs: [] };
      throw new TaskRunError();
    }
  }
  async save(archive: TaskRunArchive): Promise<void> {
    const body = JSON.stringify(taskRunArchiveSchema.parse(archive));
    if (Buffer.byteLength(body) > MAX_BYTES) throw new TaskRunError();
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, this.file);
    } catch { throw new TaskRunError(); }
    finally { await unlink(temporary).catch(() => undefined); }
  }
}

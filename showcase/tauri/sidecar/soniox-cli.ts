import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { SonioxRecognizer } from './soniox-recognizer.js';
// Existing cross-platform encrypted key store.
// @ts-expect-error The existing JS store has no declaration file.
import { createSecrets } from './secrets.mjs';

const commandSchema = z.union([
  z.object({ rate: z.number().int().min(8000).max(192000) }),
  z.object({ pcm: z.string().max(1_000_000) }), z.object({ end: z.literal(true) }),
]);

export async function main(): Promise<void> {
  const emit = (message: Readonly<Record<string, unknown>>): void => { process.stdout.write(`${JSON.stringify(message)}\n`); };
  const secrets: { get(name: string): Promise<string | undefined> } = createSecrets({ hands: process.env.ROAMIES_HANDS ?? '' });
  const key = process.env.SONIOX_API_KEY || await secrets.get('soniox');
  if (!key) { emit({ error: 'Add a Soniox API key on the Voice page.' }); return; }
  let recognizer: SonioxRecognizer | undefined;
  let complete: () => void = () => {};
  const completion = new Promise<void>((resolve) => { complete = resolve; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lines = createInterface({ input: process.stdin });
  try {
    for await (const line of lines) {
      const command = commandSchema.parse(JSON.parse(line));
      if ('rate' in command) {
        if (recognizer) throw new Error('Duplicate audio configuration');
        recognizer = new SonioxRecognizer(key, command.rate, {
          onText: (text) => emit({ text }),
          onDone: () => { emit({ done: true }); complete(); lines.close(); process.stdin.destroy(); },
          onError: (error) => { emit({ error: error.message }); complete(); lines.close(); process.stdin.destroy(); },
        });
      } else if ('pcm' in command) {
        if (!recognizer) throw new Error('Audio configuration is missing');
        recognizer.append(Buffer.from(command.pcm, 'base64'));
      } else {
        if (!recognizer) throw new Error('No audio was captured');
        recognizer.end();
        timer = setTimeout(() => { emit({ error: 'Soniox finalization timed out' }); complete(); lines.close(); process.stdin.destroy(); }, 10000);
      }
    }
    if (recognizer) {
      recognizer.end();
      timer ??= setTimeout(() => { emit({ error: 'Soniox finalization timed out' }); complete(); }, 10000);
      await completion;
    }
  } finally { clearTimeout(timer); recognizer?.cancel(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(() => { process.stdout.write('{"error":"Soniox speech helper failed"}\n'); process.exitCode = 1; });
}

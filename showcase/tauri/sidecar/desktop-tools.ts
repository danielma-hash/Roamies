import { z } from 'zod';
import type { ToolContext } from '@kenkaiiii/gg-agent';
import type { DesktopDriverService } from './desktop-driver.service.js';

export function createDesktopTools(driver: DesktopDriverService) {
  return [
    { name: 'desktop_read', description: 'Read a visible Mac app window using a compact Accessibility snapshot. Use numeric windowId from list_windows. Prefer this for native app text/controls; query filters matching role/name/value. Returned refs belong only to this window and expire in 60 seconds. Protected apps and hidden windows are refused. No screenshot or focus change.',
      parameters: z.object({ windowId: z.number().int().positive(), query: z.string().max(120).optional() }),
      execute: async ({ windowId, query }: { windowId: number; query?: string }, ctx?: ToolContext): Promise<string> => JSON.stringify(await driver.read(windowId, query, ctx?.signal)) },
    { name: 'desktop_act', description: 'Click or replace a text field using an exact ref returned by desktop_read. Works semantically without physical keyboard/mouse fallback. Each action consumes the window refs. Inspect the returned snapshot to verify the requested effect. Never repeat after unknown delivery or a timeout; read the window first. Sending, deleting or paying requires the user to have requested that exact action.',
      parameters: z.object({ ref: z.string().regex(/^@s[a-z0-9]{1,40}:e\d{1,7}$/), action: z.enum(['click', 'fill']), text: z.string().max(2000).optional() }), executionMode: 'sequential' as const,
      execute: async (args: { ref: string; action: 'click' | 'fill'; text?: string }, ctx?: ToolContext): Promise<string> => JSON.stringify(await driver.act(args, ctx?.signal)) },
  ] as const;
}

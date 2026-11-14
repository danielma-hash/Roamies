import { z } from 'zod';
import type { AgentTool } from '@kenkaiiii/gg-agent';

const families = ['core', 'sessions', 'memory', 'web', 'browser', 'desktop', 'files', 'commitments', 'visuals'] as const;
type Family = typeof families[number];
const descriptions: Readonly<Record<Family, string>> = {
  core: 'פתיחת קישור או יישום, הצגת רשימה, ציור ותכנון צעדים',
  sessions: 'מרכז סשנים, היסטוריית Claude ושליטה בסשנים מנוהלים',
  memory: 'חיפוש ASM בתחום אישי או חברה וניהול עובדות אישיות',
  web: 'קריאת אתר ציבורי ממוקדת ללא דפדפן',
  browser: 'קריאה ופעולות מאושרות באתרי JavaScript בסביבת Browser Use מבודדת',
  desktop: 'קריאה ופעולות בחלונות יישומים באמצעות Accessibility או תמונה',
  files: 'חיפוש, קריאה וכתיבת קבצים ופקודות מקומיות לפי מדיניות הבטיחות',
  commitments: 'רשימות, התחייבויות ותזכורות',
  visuals: 'קריאת תמונה והצגת הסבר חזותי',
};
const requirements: Readonly<Record<Family, readonly string[]>> = {
  core: ['Roamies UI'], sessions: ['Claude local history; Claude CLI and sign-in for managed runs; exact action approval'],
  memory: ['Local ASM sources for recall; explicit personal/company scope'], web: ['Public HTTPS access'],
  browser: ['Local Docker running; installed roamies-browser-use:1.0.4 and roamies-browser-egress:1 images'],
  desktop: ['Native helpers; visible window; macOS Accessibility where applicable; action settings and policy'],
  files: ['Local filesystem permissions and safety policy; confirmation where required'],
  commitments: ['Local Roamies storage'], visuals: ['Roamies UI; readable image when requested'],
};
function familyOf(name: string): Family {
  if (name.startsWith('claude_') || name === 'show_session_center') return 'sessions';
  if (name === 'asm_recall' || name === 'forget_fact') return 'memory';
  if (name === 'fetch_url') return 'web';
  if (name.startsWith('browser_')) return 'browser';
  if (name.startsWith('desktop_') || ['take_screenshot','list_windows','read_window','act_in_app'].includes(name)) return 'desktop';
  if (['read_file','list_files','search_files','write_file','run_command'].includes(name)) return 'files';
  if (['remember_commitment','update_commitment','list_commitments'].includes(name)) return 'commitments';
  if (name === 'see_photo') return 'visuals';
  return 'core';
}
export class CapabilityRegistryError extends Error { override readonly name = 'CapabilityRegistryError'; }

/** Tool discovery is routing, never authorization. Original tool executors keep every safety check. */
export class CapabilityRegistry {
  private readonly catalog: readonly AgentTool[];
  constructor(tools: readonly AgentTool[], private readonly actionsAllowed: () => boolean) {
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length || tools.some((tool) => tool.name === 'discover_capabilities')) throw new CapabilityRegistryError('שם כלי כפול בקטלוג.');
    this.catalog = [...tools];
  }
  forAgent(deferred = true) {
    const active: AgentTool[] = this.catalog.filter((tool) => !deferred || familyOf(tool.name) === 'core');
    const load = (family: Family): AgentTool[] => {
      const selected = this.catalog.filter((tool) => familyOf(tool.name) === family);
      for (const tool of selected) if (!active.some((item) => item.name === tool.name)) active.push(tool);
      return selected;
    };
    const discovery: AgentTool = {
      name: 'discover_capabilities',
      description: 'Discover Jarvis capabilities and load the relevant tool family before use: sessions (Claude session center/history/control), memory (ASM recall/facts), web (fetch_url first), browser (isolated JavaScript pages), desktop (app windows), files, commitments, visuals. Omit family to list configuration and requirements. configured is not a live health check. Loading tools never grants action permission. Prefer direct read/API over browser, Accessibility over screenshots; do not claim a capability is missing without discovery.',
      parameters: z.object({ family: z.enum(families).optional() }),
      executionMode: 'sequential',
      execute: async (input: unknown) => {
        const { family } = z.object({ family: z.enum(families).optional() }).parse(input);
        const selected = family ? load(family) : [];
        return { content: JSON.stringify({ actionsSettingEnabled: this.actionsAllowed(), healthChecked: false,
          capabilities: (family ? [family] : families).map((name) => {
            const tools = this.catalog.filter((tool) => familyOf(tool.name) === name);
            return { family: name, description: descriptions[name], configured: tools.length > 0, requirements: requirements[name], tools: tools.map((tool) => ({ name: tool.name, loaded: active.includes(tool), ...(family ? { description: tool.description } : {}) })) };
          }), note: 'טעינת כלים אינה הרשאה לבצע פעולה. יש לבדוק את תוצאת הכלי; הגדרה אינה הוכחת זמינות או הצלחה.' }),
          ...(deferred && selected.length ? { loadedTools: selected.map((tool) => tool.name) } : {}) };
      },
    };
    active.push(discovery);
    return { tools: active, deferredTools: deferred ? [...this.catalog.filter((tool) => familyOf(tool.name) !== 'core')] : undefined,
      resolveTool: (name: string): AgentTool | undefined => {
        const tool = this.catalog.find((item) => item.name === name);
        if (tool) load(familyOf(name));
        return tool;
      } };
  }
}

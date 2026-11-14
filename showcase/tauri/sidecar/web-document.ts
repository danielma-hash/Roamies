import { Parser } from 'htmlparser2';
import type { WebDocument } from './web-reader.types.js';

const clean = (value: string): string => value.replace(/\s+/gu, ' ').trim();
const MAX_TEXT = 200_000;
/** Parses inert text only; no script, CSS, subresource request or DOM execution. */
export function parseWebDocument(body: string, html: boolean): WebDocument {
  if (!html) return { title: '', text: body.slice(0, MAX_TEXT), tables: [], truncated: body.length > MAX_TEXT };
  const parts: string[] = []; const tables: string[][][] = []; let title = '', inTitle = false, ignored = 0, tableChars = 0;
  let table: string[][] | undefined; let row: string[] | undefined; let cell: string | undefined;
  const parser = new Parser({
    onopentag(name) {
      if (ignored) { ignored++; return; }
      if (['script', 'style', 'noscript', 'template', 'svg'].includes(name)) { ignored = 1; return; }
      if (name === 'title') inTitle = true;
      if (name === 'table' && tables.length < 3) table = [];
      if (name === 'tr' && table && table.length < 20) row = [];
      if ((name === 'td' || name === 'th') && row && row.length < 12 && tableChars < 4000) cell = '';
    },
    ontext(value) {
      if (ignored) return;
      if (inTitle) title += value; else parts.push(value);
      if (cell !== undefined) cell = (cell + value).slice(0, Math.min(200, 4000 - tableChars));
    },
    onclosetag(name) {
      if (ignored) { ignored--; return; }
      if (name === 'title') inTitle = false;
      if ((name === 'td' || name === 'th') && cell !== undefined) { const value = clean(cell); row?.push(value); tableChars += value.length; cell = undefined; }
      if (name === 'tr' && row) { if (row.some(Boolean)) table?.push(row); row = undefined; }
      if (name === 'table' && table) { tables.push(table); table = undefined; }
    },
  }, { decodeEntities: true });
  parser.end(body); const text = clean(parts.join(' '));
  return { title: clean(title).slice(0, 300), text: text.slice(0, MAX_TEXT), tables, truncated: text.length > MAX_TEXT };
}

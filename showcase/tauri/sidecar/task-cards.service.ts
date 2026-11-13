import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
const execute = promisify(execFile);
const cardSchema = z.object({ title: z.string(), url: z.string().url(), state: z.enum(['OPEN','CLOSED','MERGED']), headRefName: z.string(), headRefOid: z.string(), statusCheckRollup: z.array(z.object({ name: z.string().optional(), conclusion: z.string().optional(), status: z.string().optional(), state: z.string().optional() }).passthrough()).nullable() });
export type TaskCard = z.infer<typeof cardSchema> & { readonly observedAt: number; readonly deployment: 'unknown'; readonly monday?: string };
export class TaskCardsError extends Error { constructor(message: string) { super(message); this.name = 'TaskCardsError'; } }
export class TaskCardsService {
  private cards: readonly TaskCard[] = [];
  private updates: Promise<unknown> = Promise.resolve();
  constructor(private readonly readPr: (repo: string, number: string) => Promise<string> = async (repo, number) => {
    const result = await execute('gh', ['pr','view',number,'--repo',repo,'--json','title,url,state,headRefName,headRefOid,statusCheckRollup'], { timeout: 20_000, maxBuffer: 1024 * 1024 }); return result.stdout;
  }, private readonly filePath?: string) {}
  async load(): Promise<void> {
    if (!this.filePath) return;
    try {
      const raw: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!Array.isArray(raw)) throw new Error();
      this.cards = raw.slice(0,50).map(value => {
        const card = cardSchema.extend({observedAt:z.number(),monday:z.string().optional()}).parse(value);
        return {...card,deployment:'unknown' as const};
      });
    } catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return; throw new TaskCardsError('לא ניתן לקרוא את כרטיסי העבודה השמורים.'); }
  }
  list(): readonly TaskCard[] { return this.cards; }
  async track(url:string,monday?:string):Promise<readonly TaskCard[]> {
    const update=async()=>{
      const previous=this.cards.find(card=>card.url===url);
      const card=await this.read(url,monday??previous?.monday);
      const next=[card,...this.cards.filter(item=>item.url!==card.url)].slice(0,50);
      if(this.filePath){await mkdir(dirname(this.filePath),{recursive:true,mode:0o700});const temporary=`${this.filePath}.${randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify(next),{mode:0o600,flag:'wx'});await rename(temporary,this.filePath);}
      this.cards=next;return next;
    };
    const queued=this.updates.then(update,update);
    this.updates=queued.catch(()=>undefined);
    return queued;
  }
  async read(url: string, monday?: string): Promise<TaskCard> {
    const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9][0-9]*)\/?$/.exec(url);
    if (!match) throw new TaskCardsError('יש להזין קישור GitHub תקין ל־PR.');
    if (monday && !/^https:\/\/[a-z0-9-]+\.monday\.com\/boards\/\d+\/pulses\/\d+\/?$/i.test(monday)) throw new TaskCardsError('קישור המשימה ב־Monday אינו תקין.');
    try { const card = cardSchema.parse(JSON.parse(await this.readPr(match[1], match[2]))); return { ...card, observedAt: Date.now(), deployment: 'unknown', ...(monday ? { monday } : {}) }; }
    catch { throw new TaskCardsError('קריאת GitHub נכשלה. יש לבדוק ש־gh מותקן ומחובר לחשבון.'); }
  }
}

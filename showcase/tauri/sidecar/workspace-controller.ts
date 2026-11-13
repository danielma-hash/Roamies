import { z } from 'zod';
import { ClaudeSessionsService } from './claude-sessions.service.js';
import { ClaudeHooksService } from './claude-hooks.service.js';
import { AsmMemoryService } from './asm-memory.service.js';
import type { AsmMemoryCitation } from './asm-memory.types.js';
import { TaskCardsService } from './task-cards.service.js';
import type { TaskCard } from './task-cards.service.js';
import { AttentionService } from './attention.service.js';
import type { AttentionSnapshot, AttentionEvent } from './attention.types.js';
import { PronunciationDictionaryService } from './pronunciation-dictionary.service.js';
import type { VoiceWorkspaceState } from './browser-voice-workspace.js';
import type { ClaudeSessionList, ClaudeTranscript } from './claude-sessions.types.js';

const request = z.object({ action: z.enum(['sessions.list', 'sessions.read', 'sessions.handoff', 'sessions.fork', 'sessions.observe', 'memory.search','tasks.add','tasks.refresh','attention.preferences','attention.dismiss','voice.save','voice.remove','voice.preview','voice.previewAudio','voice.correct','voice.review']), query: z.string().max(200).optional(), id: z.string().max(100).optional(), scope: z.enum(['company','personal']).optional(), url:z.string().max(1000).optional(),monday:z.string().max(1000).optional(), quiet:z.boolean().optional(),focus:z.boolean().optional(),term:z.string().max(100).optional(),replacement:z.string().max(200).optional(),text:z.string().max(4000).optional(),on:z.boolean().optional() });
interface VoiceControls { readonly dictionary:PronunciationDictionaryService; readonly review:()=>boolean; readonly setReview:(on:boolean)=>void; readonly previewAudio:(text:string)=>void; readonly correct:(text:string)=>void }
export interface WorkspaceState extends ClaudeSessionList {
  readonly selected?: ClaudeTranscript;
  readonly handoff?: string;
  readonly busy?: boolean;
  readonly error?: string;
  readonly observing?: boolean;
  readonly citations?: readonly AsmMemoryCitation[];
  readonly cards?: readonly TaskCard[];
  readonly attention?: AttentionSnapshot;
  readonly voiceWorkspace?:VoiceWorkspaceState;
}
export class WorkspaceController {
  private current: WorkspaceState = { available: true, sessions: [] };
  private polling = false;
  private query = '';
  private nextTaskRefresh = Date.now()+300_000;
  private taskCursor = 0;
  constructor(private readonly sessions: ClaudeSessionsService, private readonly changed: () => void, private readonly hooks?: ClaudeHooksService, private readonly memory?: AsmMemoryService, private readonly tasks?: TaskCardsService, private readonly attention?: AttentionService, private readonly notify: (events:readonly AttentionEvent[])=>void = ()=>{}, private readonly voice?:VoiceControls) {}
  setTranscript(text:string):void{this.current={...this.current,voiceWorkspace:{entries:this.voice?.dictionary.list()??[],...this.current.voiceWorkspace,transcript:text.slice(0,4000)}};this.changed();}
  private updateVoice():void{if(this.voice)this.current={...this.current,voiceWorkspace:{...this.current.voiceWorkspace,entries:this.voice.dictionary.list(),review:this.voice.review(),warning:this.voice.dictionary.warning}};}
  async poll():Promise<void>{
    if(this.polling||this.current.busy)return;this.polling=true;
    try{
      if(this.tasks&&Date.now()>=this.nextTaskRefresh){this.nextTaskRefresh=Date.now()+60_000;const cards=this.tasks.list();if(cards.length){const card=cards[this.taskCursor++%cards.length];await this.tasks.track(card.url,card.monday);}}
      const all=await this.sessions.list();const events=await this.attention?.update(all.sessions,this.tasks?.list()??[]);this.current={...this.current,...all,cards:this.tasks?.list()??[],sessions:all.sessions.filter(s=>`${s.title} ${s.cwd} ${s.branch}`.toLocaleLowerCase().includes(this.query.toLocaleLowerCase())),attention:await this.attention?.snapshot()};if(events?.length)this.notify(events);this.changed();
    }catch{/* An observer failure never interrupts current work. */}finally{this.polling=false;}
  }
  async initialize():Promise<void>{try{await this.tasks?.load();await this.voice?.dictionary.load();this.updateVoice();this.current={...this.current,cards:this.tasks?.list()??[]};}catch(error){this.current={...this.current,error:error instanceof Error?error.message:'טעינת מרכז העבודה נכשלה.'};}this.changed();}
  snapshot(): WorkspaceState { return this.current; }
  async handle(value: unknown): Promise<void> {
    if (this.current.busy) return;
    const parsed = request.safeParse(value);
    if (!parsed.success) return;
    const input = parsed.data;
    this.current = { ...this.current, busy: true, error: undefined }; this.changed();
    try {
      if(input.action.startsWith('voice.')&&this.voice){
        if(input.action==='voice.save'&&input.term&&input.replacement)await this.voice.dictionary.upsert({term:input.term,replacement:input.replacement});
        if(input.action==='voice.remove'&&input.term)await this.voice.dictionary.remove(input.term);
        if(input.action==='voice.review'&&input.on!==undefined)this.voice.setReview(input.on);
        if(input.action==='voice.preview'&&input.text)this.current={...this.current,voiceWorkspace:{...this.current.voiceWorkspace,entries:this.voice.dictionary.list(),preview:this.voice.dictionary.preview(input.text)}};
        if(input.action==='voice.previewAudio'&&input.text)this.voice.previewAudio(input.text);
        if(input.action==='voice.correct'&&input.text?.trim()){this.voice.correct(input.text.trim());this.current={...this.current,voiceWorkspace:{...this.current.voiceWorkspace,entries:this.voice.dictionary.list(),transcript:undefined}};}
        this.updateVoice();return;
      }
      if(input.action==='attention.preferences'&&this.attention){await this.attention.setPreferences({quiet:input.quiet,focus:input.focus});this.current={...this.current,attention:await this.attention.snapshot()};return;}
      if(input.action==='attention.dismiss'&&input.id&&this.attention){await this.attention.dismiss(input.id);this.current={...this.current,attention:await this.attention.snapshot()};return;}
      if ((input.action==='tasks.add'||input.action==='tasks.refresh')&&input.url&&this.tasks){this.current={...this.current,cards:await this.tasks.track(input.url,input.monday)};return;}
      if (input.action === 'memory.search' && input.scope && this.memory) { this.current = { ...this.current, citations: await this.memory.search(input.query ?? '', { scope: input.scope }) }; return; }
      if (input.action === 'sessions.list') { this.query=input.query??'';this.current = { ...this.current, ...await this.sessions.list({ query: input.query }), observing: (await this.hooks?.status())?.installed }; }
      else if (input.action === 'sessions.observe' && this.hooks) { await this.hooks.install(); this.current = { ...this.current, observing: true, message: 'המעקב הופעל. שיחות Claude חדשות ישלחו אירועי מצב בלבד.' }; }
      else if (input.id) {
        if (input.action === 'sessions.read') this.current = { ...this.current, selected: await this.sessions.read(input.id), handoff: undefined };
        if (input.action === 'sessions.handoff') this.current = { ...this.current, handoff: (await this.sessions.handoff(input.id)).text };
        if (input.action === 'sessions.fork') {
          const fork = await this.sessions.fork(input.id);
          this.current = { ...this.current, ...await this.sessions.list(), handoff: `נוצר עותק עצמאי של השיחה: ${fork.id}\nפרויקט: ${fork.cwd}\nהעותק אינו מריץ משימה. אפשר לפתוח אותו ב-Claude באמצעות claude --resume ${fork.id}` };
        }
      }
    } catch (error) { this.current = { ...this.current, error: error instanceof Error ? error.message : 'לא ניתן להשלים את הפעולה.' }; }
    finally { this.current = { ...this.current, busy: false }; this.changed(); }
  }
}

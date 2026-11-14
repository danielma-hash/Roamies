import type {ToolContext} from '@kenkaiiii/gg-agent';
import { livePanelSpecSchema } from './live-panel.schema.js';
import type { LivePanelService } from './live-panel.service.js';
import type { LivePanelSpec } from './live-panel.types.js';
export function createLivePanelTool(service:LivePanelService,show:()=>void){
 return {name:'live_panel_show',description:'Show a Hebrew RTL work panel beside the session center. Use typed text, searchable table, bar chart, local preview form, board or flow blocks. No HTML, scripts, CSS, arbitrary URLs or actions. Use real sourced data and sourceNote; do not invent live numbers. Forms preview locally only and do not submit actions. This initial renderer keeps only the latest panel in process memory; do not promise persistence or background refresh. verified means the UI acknowledged rendering, never that the supplied numbers were verified.',parameters:livePanelSpecSchema,executionMode:'sequential' as const,timeoutMs:10_000,
 execute:async(spec:LivePanelSpec,ctx?:ToolContext):Promise<string>=>{ctx?.signal?.throwIfAborted();const panel=service.show(spec);show();const rendered=await service.waitForRender(panel.id,ctx?.signal);return JSON.stringify({displayRequested:true,rendered,verified:rendered,verification:'ui_render',panelId:panel.id,revision:panel.revision,...(!rendered?{warning:'לא התקבל אישור הצגה מהחלון. אין לטעון שהמסך הוצג בהצלחה.'}:{})});}};
}

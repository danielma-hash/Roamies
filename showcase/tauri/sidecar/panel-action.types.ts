import type {z} from 'zod';
import type {ToolContext} from '@kenkaiiii/gg-agent';
import type {panelActionInputSchema,panelViewBindingSchema,panelSessionActionSchema} from './panel-action.schema.js';
export type PanelActionInput=z.infer<typeof panelActionInputSchema>;
export type PanelViewBinding=z.infer<typeof panelViewBindingSchema>;
export type PanelSessionAction=z.infer<typeof panelSessionActionSchema>;
export type PanelSessionExecutor=(action:PanelSessionAction,id:string,instruction:string|undefined,context?:ToolContext)=>Promise<string>;

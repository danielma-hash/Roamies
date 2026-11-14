import {z} from 'zod';
export const panelSessionActionSchema=z.enum(['send','resume','stop']);
export const panelViewBindingSchema=z.strictObject({viewId:z.uuid(),rows:z.array(z.strictObject({ref:z.uuid(),targetId:z.uuid(),actions:z.array(panelSessionActionSchema).max(3)})).max(10)});
export const panelActionInputSchema=z.strictObject({ref:z.uuid(),action:panelSessionActionSchema,instruction:z.string().trim().min(1).max(12000).optional()});

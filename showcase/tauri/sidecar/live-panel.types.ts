import type { z } from 'zod';
import type { livePanelSpecSchema,livePanelEnvelopeSchema,liveBlockSchema } from './live-panel.schema.js';
export type LivePanelSpec=z.infer<typeof livePanelSpecSchema>;
export type LivePanelEnvelope=z.infer<typeof livePanelEnvelopeSchema>;
export type LiveBlock=z.infer<typeof liveBlockSchema>;

export type LivePanelArchive = z.infer<typeof import('./live-panel.schema.js').livePanelArchiveSchema>;

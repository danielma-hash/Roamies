import type {z} from 'zod';
import type {artifactSchema} from './artifact.schema.js';
export type ArtifactInput=z.infer<typeof artifactSchema>;
export interface ArtifactOptions {readonly allowed:()=>boolean;readonly root?:string;}

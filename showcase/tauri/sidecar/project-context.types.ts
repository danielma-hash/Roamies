export interface ProjectContextSource {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}
export interface ProjectContextReceipt {
  readonly root: string;
  readonly digest: string;
  readonly loadedAt: number;
  readonly sources: readonly ProjectContextSource[];
}
export interface ProjectContext {
  readonly receipt: ProjectContextReceipt;
  readonly prompt: string;
}

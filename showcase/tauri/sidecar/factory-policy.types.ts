export interface FactoryPolicy {
 readonly governed:boolean;
 readonly baseBranch?:string;
 readonly remote?:string;
 readonly protectedBranches:readonly string[];
}
export type FactoryInspect=(root:string,repo:string,signal?:AbortSignal)=>Promise<FactoryPolicy>;

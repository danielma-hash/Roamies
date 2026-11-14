import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {FactoryPolicyError} from './factory-policy-error.js';
import type {FactoryPolicy} from './factory-policy.types.js';
const exec=promisify(execFile);
const policy=z.strictObject({governed:z.boolean(),baseBranch:z.string().max(200).optional(),remote:z.string().max(100).optional(),protectedBranches:z.array(z.string().max(200)).max(100)});
// Fixed program, fresh process: do not cache the installed factory's governance across a plugin update.
const inspectProgram=`
import {execFileSync} from 'node:child_process';
const [moduleUrl,root,target]=process.argv.slice(1);
const factory=await import(moduleUrl);
if(['findProject','bundledProfiles','governedStubs'].some(name=>typeof factory[name]!=='function'))throw new Error('unsupported factory');
const configured=factory.findProject(root);
const known=[...factory.bundledProfiles(),...factory.governedStubs()].flatMap(p=>p.repos.map(r=>r.remoteSlug?.toLowerCase()).filter(Boolean));
const remotes=execFileSync('git',['remote','-v'],{cwd:root,encoding:'utf8',maxBuffer:65536,timeout:5000}).split('\\n').filter(Boolean);
const governed=!!configured||known.includes(target.toLowerCase())||remotes.some(line=>{
 const url=line.split(/\\s+/)[1]?.replace(/\\/$/,'').replace(/\\.git$/,'');
 const match=url?.match(/^(?:https:\\/\\/github\\.com\\/|git@github\\.com:)([A-Za-z0-9_-]+\\/[A-Za-z0-9_.-]+)$/);
 return !match||known.includes(match[1].toLowerCase());
});
console.log(JSON.stringify({governed,...(configured?{baseBranch:configured.baseBranch,remote:configured.remote}:{}),protectedBranches:configured?.protectedBranches??[]}));
`;
/** Uses the installed factory's landed configuration and global stubs, never branch-local rules alone. */
export class FactoryPolicyService {
 constructor(private readonly modulePath=join(homedir(),'.codex/plugins/cache/ipcom-factory/factory/local/dist/config.js')){}
 async inspect(root:string,repo:string,signal?:AbortSignal):Promise<FactoryPolicy>{
  try{
   const {stdout}=await exec(process.execPath,['--input-type=module','-e',inspectProgram,pathToFileURL(this.modulePath).href,root,repo],{cwd:root,encoding:'utf8',timeout:12_000,maxBuffer:65_536,signal});
   return policy.parse(JSON.parse(stdout));
  }catch{throw new FactoryPolicyError('לא ניתן לאמת את מדיניות המפעל המותקן. פתיחת PR חסומה עד שהבדיקה זמינה.');}
 }
}

import {afterEach,it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {FactoryPolicyService} from '../factory-policy.service.js';
const exec=promisify(execFile),roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(){const root=await mkdtemp('/tmp/roamies-factory-');roots.push(root);await exec('git',['init','-q'],{cwd:root});const module=join(root,'config.mjs');await writeFile(module,"export const findProject=()=>undefined; export const bundledProfiles=()=>[]; export const governedStubs=()=>[{repos:[{remoteSlug:'company/guarded'}]}];");return {root,module,service:new FactoryPolicyService(module)};}
it('checks global governed stubs even without a local .factory directory',async()=>{const f=await fixture();expect((await f.service.inspect(f.root,'company/guarded')).governed).toBe(true);expect((await f.service.inspect(f.root,'personal/free')).governed).toBe(false);});
it('checks every remote and refuses ambiguous remote aliases',async()=>{const f=await fixture();await exec('git',['remote','add','secondary','git@github.com:company/guarded.git'],{cwd:f.root});expect((await f.service.inspect(f.root,'personal/free')).governed).toBe(true);await exec('git',['remote','set-url','secondary','git@work-alias:personal/free.git'],{cwd:f.root});expect((await f.service.inspect(f.root,'personal/free')).governed).toBe(true);});
it('uses the installed configuration and does not cache it across calls',async()=>{const f=await fixture();expect((await f.service.inspect(f.root,'personal/free')).governed).toBe(false);await writeFile(f.module,"export const findProject=()=>({baseBranch:'test',remote:'work',protectedBranches:['test']}); export const bundledProfiles=()=>[]; export const governedStubs=()=>[];");expect(await f.service.inspect(f.root,'personal/free')).toEqual({governed:true,baseBranch:'test',remote:'work',protectedBranches:['test']});});
it('fails closed when the installed module is missing or incompatible',async()=>{const f=await fixture();await expect(new FactoryPolicyService(join(f.root,'missing.mjs')).inspect(f.root,'personal/free')).rejects.toThrow('חסומה');await writeFile(f.module,'export const nothing=true;');await expect(f.service.inspect(f.root,'personal/free')).rejects.toThrow('חסומה');});

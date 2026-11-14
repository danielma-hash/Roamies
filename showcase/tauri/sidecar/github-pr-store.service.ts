import {constants} from 'node:fs';
import {mkdir,open,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {githubPrJournalSchema} from './github-pr.schema.js';
import type {GitHubPrIntent} from './github-pr.types.js';
import {GitHubReadError} from './github-read-error.js';
/** One sidecar owns this journal. An uncertain POST is never automatically retried. */
export class GitHubPrStoreService {
 constructor(private readonly file:string){}
 async load():Promise<GitHubPrIntent[]>{
  try{const handle=await open(this.file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   try{const stat=await handle.stat();if(!stat.isFile()||stat.size>200_000)throw new Error('size');const buffer=Buffer.alloc(stat.size+1);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead!==stat.size)throw new Error('changed');return githubPrJournalSchema.parse(JSON.parse(buffer.toString('utf8',0,bytesRead))).intents;}finally{await handle.close();}
  }catch(error:unknown){if(error!==null&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')return [];throw new GitHubReadError('יומן פתיחת PR אינו קריא. אין לבצע כתיבה עד לבירור.');}
 }
 async save(intents:readonly GitHubPrIntent[]):Promise<void>{
  const data=JSON.stringify(githubPrJournalSchema.parse({version:1,intents}));const temporary=`${this.file}.${randomUUID()}.tmp`;
  try{await mkdir(dirname(this.file),{recursive:true,mode:0o700});const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}await rename(temporary,this.file);}
  catch{throw new GitHubReadError('לא ניתן לשמור כוונת PR. כתיבה נוספת חסומה עד לבירור.');}
  finally{await unlink(temporary).catch(()=>undefined);}
 }
}

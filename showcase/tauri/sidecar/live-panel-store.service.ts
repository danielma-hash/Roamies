import { constants } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { livePanelArchiveSchema } from './live-panel.schema.js';
import type {LivePanelArchive} from './live-panel.types.js';
import {LivePanelError} from './live-panel.error.js';

const MAX_BYTES=6_000_000;
/** One sidecar owns this profile. Atomic replacement; recovery never executes a panel action. */
export class LivePanelStoreService {
 constructor(private readonly file:string){}
 async load():Promise<LivePanelArchive>{
  try{
   const handle=await open(this.file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   try{
    const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_BYTES)throw new LivePanelError('storage');
    const buffer=Buffer.alloc(stat.size+1);let offset=0;
    while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
    if(offset>stat.size)throw new LivePanelError('storage');
    return livePanelArchiveSchema.parse(JSON.parse(buffer.toString('utf8',0,offset)));
   }finally{await handle.close();}
  }catch(error:unknown){
   if(error!==null&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')return {version:1,panels:[]};
   throw new LivePanelError('storage');
  }
 }
 async save(input:LivePanelArchive):Promise<void>{
  const body=JSON.stringify(livePanelArchiveSchema.parse(input));if(Buffer.byteLength(body)>MAX_BYTES)throw new LivePanelError('storage');
  const temporary=`${this.file}.${randomUUID()}.tmp`;
  try{
   await mkdir(dirname(this.file),{recursive:true,mode:0o700});const handle=await open(temporary,'wx',0o600);
   try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}
   await rename(temporary,this.file);
  }catch{throw new LivePanelError('storage');}
  finally{await unlink(temporary).catch(()=>undefined);}
 }
}

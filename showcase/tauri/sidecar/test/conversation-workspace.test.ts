import { expect,it } from 'vitest';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationWorkspaceService } from '../conversation-workspace.service.js';
it('searches Hebrew and persists bookmarks without editing original conversations',async()=>{const dir=await mkdtemp(join(tmpdir(),'history-'));try{await mkdir(join(dir,'sessions'));const id='20261113-080000-abcdef';const raw=JSON.stringify({version:1,id,provider:'openai',model:'test',startedAt:1,messages:[{role:'user',content:'בדיקת זיכרון בעברית'}]});await writeFile(join(dir,'sessions',id+'.json'),raw);const service=new ConversationWorkspaceService(dir);expect(await service.list('זיכרון')).toHaveLength(1);await service.bookmark(id,true);const other=new ConversationWorkspaceService(dir);await other.load();expect((await other.list())[0].bookmarked).toBe(true);await expect(other.read('../../auth')).rejects.toThrow();expect((await other.read(id)).messages[0].content).toBe('בדיקת זיכרון בעברית');}finally{await rm(dir,{recursive:true,force:true});}});

import {afterEach,it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {AsmMemoryService} from '../asm-memory.service.js';
import {CapabilityRegistry} from '../capability-registry.js';
import {createAsmRecordTool} from '../asm-record-tool.js';
import {z} from 'zod';
import {asmRecordSchema} from '../asm-record.schema.js';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const row=(id:string,extra:Record<string,unknown>={})=>({id,summary:'Roamies מקור בדיקה',details:'תיאור עברי',files:['Projects/Roamies'],decisions:['החלטה מקורית'],open_threads:['נושא פתוח'],created_at:'2026-11-14T08:00:00Z',...extra});
const input={id:'memory:fixture',scope:'personal' as const,project:'roamies'};
it('keeps the record prefix check local for ChatGPT strict tool compatibility',()=>{
 expect(asmRecordSchema.safeParse(input).success).toBe(true);
 expect(asmRecordSchema.safeParse({...input,id:'vault:fixture'}).success).toBe(false);
 expect(z.toJSONSchema(asmRecordSchema.shape.id)).not.toHaveProperty('pattern');
});
async function fixture(rows:readonly object[]=[row('fixture')]){
 const root=await mkdtemp('/tmp/roamies-asm-record-');roots.push(root);
 await writeFile(join(root,'brain.json'),JSON.stringify({nodes:[]}));
 const save=async(values:readonly object[])=>writeFile(join(root,'memory.jsonl'),values.map(v=>JSON.stringify(v)).join('\n'));
 await save(rows);await writeFile(join(root,'lifecycle.jsonl'),'');
 return {root,save,service:new AsmMemoryService({root})};
}
it('reads the complete stored record in bounded pinned pages without opening referenced files',async()=>{
 const f=await fixture([row('fixture',{details:'עברית ארוכה '.repeat(1000),files:['Roamies /must/not/read.md']})]);
 let part=await f.service.readRecord(input),all=part.text;expect(part).toMatchObject({historical:true,verified:false,untrustedContent:true,status:'active'});
 expect(part.text.length).toBeLessThanOrEqual(4000);
 while(part.nextOffset!==undefined){part=await f.service.readRecord({...input,offset:part.nextOffset,expectedDigest:part.digest});all+=part.text;expect(part.text.length).toBeLessThanOrEqual(4000);}
 expect(JSON.parse(all)).toMatchObject({details:'עברית ארוכה '.repeat(1000),decisions:['החלטה מקורית'],open_threads:['נושא פתוח']});
});
it('requires a pinned digest for continuation and rejects edits or retirement between pages',async()=>{
 const f=await fixture([row('fixture',{details:'תוכן '.repeat(1500)})]);const first=await f.service.readRecord(input);
 await expect(f.service.readRecord({...input,offset:4000})).rejects.toThrow('גרסת');
 await f.save([row('fixture',{details:'עוד תוכן '.repeat(1500)})]);
 await expect(f.service.readRecord({...input,offset:4000,expectedDigest:first.digest})).rejects.toThrow('השתנתה');
 const now=await f.service.readRecord(input);
 await writeFile(join(f.root,'lifecycle.jsonl'),JSON.stringify({id:'lc_retired',op:'retire',target:{kind:'record',id:'fixture'},reason:'test'}));
 await expect(f.service.readRecord({...input,offset:4000,expectedDigest:now.digest})).rejects.toThrow('אינה זמינה');
});
it('enforces scope/project on every exposed field and excludes ambiguous or superseded records',async()=>{
 const f=await fixture([row('fixture'),row('mixed',{decisions:['Vocaly company-only detail']}),row('old'),row('new',{supersedes:['old']}),row('duplicate'),row('duplicate')]);
 for(const value of [{...input,scope:'company'},{...input,project:'anna'},{...input,id:'memory:mixed'},{...input,id:'memory:old'},{...input,id:'memory:duplicate'},{...input,id:'memory:missing'}])await expect(f.service.readRecord(value)).rejects.toThrow('אינה זמינה');
 await expect(f.service.readRecord({...input,id:'vault:anything'})).rejects.toThrow();
});
it('redacts credentials before escaping JSON and splitting pages, including arrays and multiline keys',async()=>{
 const f=await fixture([row('fixture',{details:'א'.repeat(3900)+' password="hidden secret"\n-----BEGIN PRIVATE KEY-----\nPRIVATE_DATA\n-----END PRIVATE KEY-----',decisions:['api_key=hidden-decision'],open_threads:['Bearer hidden-thread'],files:['Roamies password=hidden-path']})]);
 let part=await f.service.readRecord(input),all=part.text;
 while(part.nextOffset!==undefined){part=await f.service.readRecord({...input,offset:part.nextOffset,expectedDigest:part.digest});all+=part.text;}
 for(const secret of ['hidden secret','PRIVATE_DATA','hidden-decision','hidden-thread','hidden-path'])expect(all).not.toContain(secret);
 expect(all).toContain('[redacted]');expect(()=>JSON.parse(all)).not.toThrow();
});
it('fails closed on missing lifecycle, oversized records and invalid offsets',async()=>{
 const f=await fixture();await expect(f.service.readRecord({...input,offset:99999,expectedDigest:(await f.service.readRecord(input)).digest})).rejects.toThrow('מחוץ');
 await expect(f.service.readRecord({...input,offset:-1})).rejects.toThrow();
 await f.save([row('fixture',{details:'א'.repeat(131073)})]);await expect(f.service.readRecord(input)).rejects.toThrow('גדולה');
 await rm(join(f.root,'lifecycle.jsonl'));await expect(f.service.readRecord(input)).rejects.toThrow('חסר');
});
it('loads the reader only with the memory family',async()=>{
 const f=await fixture();const tool=createAsmRecordTool(f.service),selection=new CapabilityRegistry([tool],()=>false).forAgent();
 expect(selection.tools.map(t=>t.name)).toEqual(['discover_capabilities']);
 await selection.tools[0]!.execute({family:'memory'},{signal:new AbortController().signal,toolCallId:'test'});
 expect(selection.tools.map(t=>t.name)).toContain('asm_read_record');
 expect(JSON.parse(await tool.execute(input))).toMatchObject({id:input.id,historical:true,verified:false});
});

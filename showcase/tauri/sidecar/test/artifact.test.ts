import {afterEach,it,expect} from 'vitest';
import {mkdtemp,realpath,readFile,writeFile,stat,rm,symlink,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Window} from 'happy-dom';
import {ArtifactService} from '../artifact.service.js';
import {createArtifactTool} from '../artifact-tool.js';
import {CapabilityRegistry} from '../capability-registry.js';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(){const base=await realpath(await mkdtemp('/tmp/roamies-artifact-'));roots.push(base);let allowed=true;const root=join(base,'exports');return {base,root,deny:()=>{allowed=false;},service:new ArtifactService({root,allowed:()=>allowed})};}
const report={format:'html',title:'בדיקת Jarvis בעברית',text:'שורה בעברית\nA short English line',table:{columns:['מערכת','מצב'],rows:[['Jarvis','מוכן'],['Claude',2]]},sources:[{title:'מקור בדיקה',url:'https://example.com',accessedAt:'2026-11-14'}]};
it('writes private RTL HTML, verifies bytes and reuses an identical export after restart',async()=>{
 const f=await fixture(),first=await f.service.create(report),again=await new ArtifactService({root:f.root,allowed:()=>true}).create(report);
 expect(first).toMatchObject({created:true,fileVerified:true,contentVerified:false});expect(again).toMatchObject({created:false,path:first.path,sha256:first.sha256});
 expect((await stat(first.path)).mode&0o777).toBe(0o600);expect(await readdir(f.root)).toHaveLength(1);
 const page=new Window();page.document.write(await readFile(first.path,'utf8'));
 expect(page.document.documentElement.dir).toBe('rtl');expect(page.document.documentElement.lang).toBe('he');
 expect(page.document.querySelectorAll('tbody tr')).toHaveLength(2);expect(page.document.body.textContent).toContain(report.text);
 expect(page.document.querySelector('a')?.href).toBe('https://example.com/');page.happyDOM.abort();
});
it('renders hostile markup as text with no scripts, executable attributes or external resources',async()=>{
 const f=await fixture(),value='<script>alert(1)</script><img src="https://evil.test/x" onerror="alert(1)">';
 const result=await f.service.create({...report,title:value,text:value,table:{columns:[value],rows:[[value]]},sources:[{title:value,url:'https://example.com/"onclick="alert(1)'}]});
 const page=new Window();page.document.write(await readFile(result.path,'utf8'));
 expect(page.document.querySelectorAll('script,img,iframe,[onclick],[onerror]')).toHaveLength(0);
 expect(page.document.querySelector('h1')?.textContent).toBe(value);expect(page.document.querySelector('meta[http-equiv]')?.getAttribute('content')).toContain("default-src 'none'");page.happyDOM.abort();
});
it('produces CSV with UTF-8 BOM, escaped cells, guarded formulas and source attribution',async()=>{
 const f=await fixture(),result=await f.service.create({format:'csv',title:'טבלה',table:{columns:['טקסט','ערך'],rows:[['=1+1',-2],[' \u200f@SUM(1)',true],['מילה, "ציטוט"\nשורה',null]]},sources:report.sources});
 const csv=await readFile(result.path,'utf8');expect(csv.startsWith('\ufeff')).toBe(true);expect(csv).toContain('"\'=1+1","-2"');expect(csv).toContain('"\' \u200f@SUM(1)"');expect(csv).toContain('מילה, ""ציטוט""\nשורה');expect(csv).toContain('"מקורות"');expect(csv).toContain('https://example.com');
});
it('rejects mismatched tables, unsupported CSV prose, unsafe sources and known credentials',async()=>{
 const f=await fixture();
 for(const input of [{...report,table:{columns:['a'],rows:[[1,2]]}},{...report,format:'csv'},{...report,table:undefined,format:'csv',text:undefined},{...report,sources:[{title:'bad',url:'javascript:alert(1)'}]},{...report,sources:[{title:'bad',url:'https://user:password@example.com'}]},{...report,text:'password="hidden"'},{...report,text:'-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----'}])await expect(f.service.create(input)).rejects.toThrow();
 await expect(stat(f.root)).rejects.toThrow();
});
it('does not overwrite altered files or follow output directory/file symlinks',async()=>{
 const f=await fixture(),first=await f.service.create(report);await writeFile(first.path,'other content');await expect(f.service.create(report)).rejects.toThrow();expect(await readFile(first.path,'utf8')).toBe('other content');
 await rm(first.path);const secret=join(f.base,'unrelated.txt');await writeFile(secret,'unchanged');await symlink(secret,first.path);await expect(f.service.create(report)).rejects.toThrow();expect(await readFile(secret,'utf8')).toBe('unchanged');
 const link=join(f.base,'alias');await symlink(f.root,link);await expect(new ArtifactService({root:link,allowed:()=>true}).create(report)).rejects.toThrow('סמלי');
});
it('checks action permission and serializes identical concurrent requests',async()=>{
 const cancelled=await fixture();const controller=new AbortController();controller.abort();await expect(cancelled.service.create(report,controller.signal)).rejects.toThrow();await expect(stat(cancelled.root)).rejects.toThrow();
 const f=await fixture();f.deny();await expect(f.service.create(report)).rejects.toThrow('פעולות');await expect(stat(f.root)).rejects.toThrow();
 const g=await fixture();const results=await Promise.all([g.service.create(report),g.service.create(report)]);expect(results.map(x=>x.created)).toEqual([true,false]);
});
it('bounds rendered bytes and loads the tool only with files',async()=>{
 const f=await fixture();await expect(f.service.create({...report,table:{columns:Array(12).fill('c'),rows:Array.from({length:200},()=>Array(12).fill('א'.repeat(1000)))}})).rejects.toThrow('הגודל');
 const tool=createArtifactTool(f.service),selection=new CapabilityRegistry([tool],()=>true).forAgent();expect(selection.tools.map(t=>t.name)).toEqual(['discover_capabilities']);
 await selection.tools[0]!.execute({family:'files'},{signal:new AbortController().signal,toolCallId:'test'});expect(selection.tools.map(t=>t.name)).toContain('artifact_export');
});

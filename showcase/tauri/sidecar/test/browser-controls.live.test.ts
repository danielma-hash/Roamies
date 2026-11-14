import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { BrowserTaskService } from '../browser-task.service.js';
import { BrowserControlsService } from '../browser-controls.service.js';
import { localDockerProcess } from '../docker-process.service.js';

it.skipIf(process.env.ROAMIES_BROWSER_LIVE!=='1')('fills and clicks real Chromium fixture controls with stale-document and iframe checks',async()=>{
 const docker=localDockerProcess();if(!docker)throw new Error('Docker unavailable');const ownerId=randomBytes(16).toString('hex');
 const tasks=new BrowserTaskService({docker:(args,input,signal)=>docker.run(args,input,signal),ownerId,hostSubnets:()=>Object.values(networkInterfaces()).flatMap(x=>x??[]).filter(x=>x.family==='IPv4').map(x=>x.cidr??`${x.address}/32`)});
 const approvals:string[]=[];
 const controls=new BrowserControlsService({inspect:(id,signal)=>tasks.inspectControls(id,signal),apply:(target,signal)=>tasks.applyControl(target,signal),read:(id,signal)=>tasks.read({jobId:id},signal),allowActions:()=>true,confirm:async(question)=>{approvals.push(question);return true;}});
 try {
  const page=await tasks.open('https://example.com');const container=`roamies-${ownerId.slice(0,8)}-${page.jobId}-browser`;
  const run=(script:string)=>docker.run(['exec','-i',container,'browser-use'],script);
  // Permanent regression fixture injected only into this test-owned isolated tab. No external form is submitted.
  const html=`<!doctype html><html lang="he" dir="rtl"><title>Jarvis fixture</title><label>שם<input id="name"></label><input type="password" aria-label="סוד" value="must-not-read"><input type="file" aria-label="קובץ"><input disabled aria-label="חסום"><button id="send" onclick="document.getElementById('result').textContent='נשלח: '+document.getElementById('name').value">שלח בדיקה</button><p id="result"></p><iframe srcdoc="<label>שדה פנימי<input id='inner'></label>"></iframe><iframe sandbox srcdoc="<label>מסגרת חסומה<input></label>"></iframe></html>`;
  await run(`import json\nhtml=json.loads(${JSON.stringify(JSON.stringify(html))})\nframe=cdp('Page.getFrameTree')['frameTree']['frame']['id']\ncdp('Page.setDocumentContent',frameId=frame,html=html)\nprint('fixture ready')`);
  let view=await controls.inspect(page.jobId);
  expect(view.controls.some(x=>['סוד','קובץ','חסום','מסגרת חסומה'].includes(x.name))).toBe(false);
  const field=view.controls.find(x=>x.name==='שם');expect(field).toBeDefined();
  const fill=await controls.act({ref:field!.ref,action:'fill',text:'Jarvis בעברית'});expect(fill).toMatchObject({delivery:'delivered',verified:true,verification:'field_value'});
  await expect(controls.act({ref:field!.ref,action:'fill',text:'again'})).rejects.toThrow('ההפניה');
  view=await controls.inspect(page.jobId);expect(view.controls.find(x=>x.name==='שם')?.value).toBe('Jarvis בעברית');
  const click=await controls.act({ref:view.controls.find(x=>x.name==='שלח בדיקה')!.ref,action:'click'});expect(click).toMatchObject({delivery:'delivered',verified:false,page:{text:expect.stringContaining('נשלח: Jarvis בעברית')}});
  view=await controls.inspect(page.jobId);const inner=view.controls.find(x=>x.name==='שדה פנימי');expect(inner).toBeDefined();
  expect(await controls.act({ref:inner!.ref,action:'fill',text:'iframe עברית'})).toMatchObject({delivery:'delivered',verified:true});
  view=await controls.inspect(page.jobId);const stale=view.controls.find(x=>x.name==='שלח בדיקה')!;
  await run("js(\"document.getElementById('send').textContent='Changed SPA control'\")\nprint('changed')");
  expect(await controls.act({ref:stale.ref,action:'click'})).toMatchObject({delivery:'not_delivered',verified:false});
  view=await controls.inspect(page.jobId);const removed=view.controls.find(x=>x.name==='שם')!;
  await run("js(\"document.getElementById('name').replaceWith(document.getElementById('name').cloneNode(true))\")\nprint('replaced')");
  expect(await controls.act({ref:removed.ref,action:'fill',text:'must not type'})).toMatchObject({delivery:'not_delivered',verified:false});
  view=await controls.inspect(page.jobId);const old=view.controls.find(x=>x.name==='שם')!;
  await run("cdp('Page.navigate',url='https://example.com/?jarvis-fixture=next')\nprint('navigated')");
  expect(await controls.act({ref:old.ref,action:'fill',text:'must not type'})).toMatchObject({delivery:'not_delivered',verified:false});
  expect(approvals).toHaveLength(6);expect(await tasks.close(page.jobId)).toEqual({closed:true});
 }finally{await tasks.closeAll();}
},120_000);

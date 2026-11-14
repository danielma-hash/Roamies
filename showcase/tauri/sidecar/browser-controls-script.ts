// Fixed Browser Use/CDP glue. Model arguments are JSON data, never source code or method names.
const metadata = `function(){
 const tag=this.tagName?.toLowerCase(),type=(this.getAttribute('type')||'').toLowerCase();
 const style=getComputedStyle(this),visible=this.isConnected&&this.getClientRects().length>0&&style.visibility==='visible'&&style.display!=='none';
 const allowed=tag==='textarea'||(tag==='input'&&['','text','search','email','tel','url','number'].includes(type));
 return {tag,type,visible,disabled:!!this.disabled||this.matches(':disabled')||this.getAttribute('aria-disabled')==='true',readOnly:!!this.readOnly||this.getAttribute('aria-readonly')==='true',
 signature:JSON.stringify([tag,type,this.getAttribute('name'),this.getAttribute('aria-label'),this.getAttribute('placeholder'),this.getAttribute('title'),this.textContent?.slice(0,240),this.href||'',this.formAction||'']),
 value:allowed?String(this.value||'').slice(0,2000):'',fillable:allowed,
 href:tag==='a'?this.href:''};
}`;
const apply = `function(p){
 const info=(${metadata}).call(this);
 if(!info.visible||info.disabled||info.readOnly||info.type==='password'||info.type==='file'||info.signature!==p.signature||location.href!==p.frameUrl)return {status:'rejected',reason:'stale_or_unavailable'};
 if(p.action==='fill'){
  if(!info.fillable)return {status:'rejected',reason:'not_text_field'};
  const proto=info.tag==='textarea'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(this,p.text);
  this.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:p.text}));
  this.dispatchEvent(new Event('change',{bubbles:true}));
  return {status:'delivered',verified:this.value===p.text,verification:'field_value'};
 }
 if(!['button','a','input'].includes(info.tag))return {status:'rejected',reason:'unsupported_semantic_click'};
 HTMLElement.prototype.click.call(this);
 return {status:'delivered',verified:false};
}`;
const setup = `
switch_tab(p['tab'])
root=cdp('Page.getFrameTree')['frameTree']
def frames(tree):
 result=[tree['frame']]
 for child in tree.get('childFrames',[]):result.extend(frames(child))
 return result
all_frames=frames(root)
def isolated(frame):return cdp('Page.createIsolatedWorld',frameId=frame['id'],worldName='jarvis-controls')['executionContextId']
def same_origin(ctx):
 expression='(()=>{try{return Boolean(top.document)&&top.location.href==='+json.dumps(root['frame']['url'])+'}catch{return false}})()'
 return cdp('Runtime.evaluate',expression=expression,contextId=ctx,returnByValue=True).get('result',{}).get('value') is True
def object_id(backend,ctx):return cdp('DOM.resolveNode',backendNodeId=backend,executionContextId=ctx)['object']['objectId']
def call(obj,code,args=[]):
 result=cdp('Runtime.callFunctionOn',objectId=obj,functionDeclaration=code,arguments=[{'value':arg} for arg in args],returnByValue=True)
 if 'exceptionDetails' in result:raise RuntimeError('DOM operation did not return a result')
 return result['result'].get('value')
`;
export const INSPECT_CONTROLS = setup + `
controls=[]
skipped=0
for frame in all_frames[:5]:
 if frame.get('securityOrigin')!=root['frame'].get('securityOrigin') and frame['url'] not in ['about:srcdoc','about:blank']:
  skipped+=1
  continue
 try:
  ctx=isolated(frame)
  if not same_origin(ctx):
   skipped+=1
   continue
 except Exception:
  if frame['id']==root['frame']['id']:raise
  skipped+=1
  continue
 nodes=cdp('Accessibility.getFullAXTree',frameId=frame['id']).get('nodes',[])
 for node in nodes[:2000]:
  role=node.get('role',{}).get('value','')
  backend=node.get('backendDOMNodeId')
  if role not in ['button','link','textbox','combobox','checkbox'] or not backend or node.get('ignored'):continue
  obj=object_id(backend,ctx)
  try:meta=call(obj,${JSON.stringify(metadata)})
  finally:cdp('Runtime.releaseObject',objectId=obj)
  if not meta or not meta['visible'] or meta['disabled'] or meta['readOnly'] or meta['type'] in ['password','file','hidden']:continue
  actions=[]
  if meta['fillable']:actions.append('fill')
  if meta['tag'] in ['button','a'] or (meta['tag']=='input' and meta['type'] in ['button','submit','reset','checkbox','radio']):actions.append('click')
  if not actions:continue
  controls.append({'frameId':frame['id'],'loaderId':frame['loaderId'],'frameUrl':frame['url'],'backendNodeId':backend,'role':role,'name':str(node.get('name',{}).get('value',''))[:160],'signature':meta['signature'],'value':meta['value'],'href':meta['href'],'actions':actions})
  if len(controls)>=30:break
 if len(controls)>=30:break
print(json.dumps({'source':root['frame']['url'],'controls':controls,'truncated':len(controls)>=30 or len(all_frames)>5,'framesSkipped':skipped}))
`;
export const APPLY_CONTROL = setup + `
def perform():
 target=p['target']
 frame=next((f for f in all_frames if f['id']==target['frameId']),None)
 if root['frame']['url']!=target['source'] or not frame or frame['loaderId']!=target['loaderId'] or frame['url']!=target['frameUrl']:
  return {'status':'rejected','reason':'document_changed'}
 try:
  nodes=cdp('Accessibility.getPartialAXTree',backendNodeId=target['backendNodeId'],fetchRelatives=False).get('nodes',[])
  node=next((n for n in nodes if n.get('backendDOMNodeId')==target['backendNodeId']),{})
  if node.get('role',{}).get('value')!=target['role'] or str(node.get('name',{}).get('value',''))[:160]!=target['name']:
   return {'status':'rejected','reason':'element_changed'}
  ctx=isolated(frame)
  if not same_origin(ctx):return {'status':'rejected','reason':'frame_origin_changed'}
  obj=object_id(target['backendNodeId'],ctx)
 except Exception:return {'status':'rejected','reason':'reference_unavailable'}
 try:return call(obj,${JSON.stringify(apply)},[target])
 finally:
  try:cdp('Runtime.releaseObject',objectId=obj)
  except Exception:pass
print(json.dumps(perform()))
`;

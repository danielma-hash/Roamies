import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AgentTool } from '@kenkaiiii/gg-agent';
import { CapabilityRegistry } from '../capability-registry.js';
const context = () => ({signal:new AbortController().signal,toolCallId:'fixture'});
function fixture() {
  let allowed = false;
  const execute = vi.fn(async () => { if (!allowed) throw new Error('denied'); return 'executed'; });
  const names = ['draw','open','claude_sessions','claude_control_start','asm_recall','fetch_url','browser_open','browser_close','desktop_read','desktop_act','read_file','write_file','remember_commitment','see_photo'];
  const tools: AgentTool[] = names.map((name) => ({name,description:name,parameters:z.object({}),execute}));
  const registry = new CapabilityRegistry(tools,()=>allowed);
  return {registry,tools,execute,allow:()=>{allowed=true;}};
}
it('starts with core plus discovery and loads only the requested family', async () => {
  const f = fixture(); const selection = f.registry.forAgent();
  expect(selection.tools.map(x=>x.name)).toEqual(['draw','open','discover_capabilities']);
  const discovery = selection.tools.at(-1)!;
  const result = await discovery.execute({family:'browser'},context());
  expect(typeof result).toBe('object');
  expect(result).toMatchObject({loadedTools:['browser_open','browser_close']});
  expect(selection.tools.map(x=>x.name)).toEqual(['draw','open','discover_capabilities','browser_open','browser_close']);
  expect(f.execute).not.toHaveBeenCalled();
  await discovery.execute({family:'browser'},context()); expect(selection.tools).toHaveLength(5);
});
it('lists actual configuration and current setting without granting permission', async () => {
  const f = fixture(); const selection = f.registry.forAgent(); const discovery = selection.tools.at(-1)!;
  const result = await discovery.execute({},context()); if(typeof result==='string')throw new Error('expected structured result');
  expect(JSON.parse(String(result.content))).toMatchObject({actionsSettingEnabled:false,healthChecked:false});
  await discovery.execute({family:'desktop'},context());
  const act = selection.tools.find(x=>x.name==='desktop_act')!;
  expect(act).toBe(f.tools.find(x=>x.name==='desktop_act'));
  await expect(act.execute({},context())).rejects.toThrow('denied');
  f.allow(); expect(await act.execute({},context())).toBe('executed');
  const next = await discovery.execute({},context()); if(typeof next==='string')throw new Error('expected structured result');
  expect(JSON.parse(String(next.content)).actionsSettingEnabled).toBe(true);
});
it('does not invent missing adapters and keeps independent agent selections', async () => {
  const registry = new CapabilityRegistry([{name:'open',description:'open',parameters:z.object({}),execute:async()=>''}],()=>false);
  const selection=registry.forAgent();const result=await selection.tools.at(-1)!.execute({family:'browser'},context());
  if(typeof result==='string')throw new Error('expected structured result');
  expect(JSON.parse(String(result.content)).capabilities[0]).toMatchObject({configured:false,tools:[]});
  expect(result.loadedTools).toBeUndefined();
  const f=fixture();const one=f.registry.forAgent(),two=f.registry.forAgent();one.resolveTool('read_file');
  expect(one.tools.some(x=>x.name==='write_file')).toBe(true);expect(two.tools.some(x=>x.name==='read_file')).toBe(false);
});
it('resolves only exact registered tools and preserves original executors', async () => {
  const f=fixture();const selection=f.registry.forAgent();
  expect(selection.resolveTool('claude_control_start')).toBe(f.tools.find(x=>x.name==='claude_control_start'));
  expect(selection.tools.some(x=>x.name==='claude_sessions')).toBe(true);
  expect(selection.resolveTool('invented')).toBeUndefined(); expect(f.execute).not.toHaveBeenCalled();
});
it('keeps all tool definitions on the Claude Code MCP transport', async () => {
  const f=fixture();const selection=f.registry.forAgent(false);
  expect(selection.tools).toHaveLength(f.tools.length+1);expect(selection.deferredTools).toBeUndefined();
  const result=await selection.tools.at(-1)!.execute({family:'sessions'},context());
  if(typeof result==='string')throw new Error('expected structured result'); expect(result.loadedTools).toBeUndefined();
});
it('rejects duplicate tool identities', () => {
  const f=fixture(); expect(()=>new CapabilityRegistry([...f.tools,f.tools[0]],()=>false)).toThrow('כפול');
});

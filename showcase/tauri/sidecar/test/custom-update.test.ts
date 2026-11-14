import {readFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
const source=readFileSync(new URL('../../../panel/panel.js',import.meta.url),'utf8');
it('never labels a disabled custom update channel as up to date, even with an old success result',()=>{
 const start=source.indexOf('  const FRESH =');const end=source.indexOf("  $('head-update').addEventListener",start);expect(start).toBeGreaterThan(0);
 const button={hidden:true,textContent:'',disabled:false,className:'',title:'',setAttribute:vi.fn()};const schedule=vi.fn();
 const run=new Function('state','$','clearTimeout','setTimeout',`${source.slice(start,end)};updateButton();`);
 run({version:'fixture',update:{disabled:true,result:{ok:true,at:Date.now()},available:'99.0.0'}},()=>button,()=>{},schedule);
 expect(button.textContent).toBe('עדכון ידני');expect(button.disabled).toBe(true);expect(button.title).toContain('לא נבדקה');expect(schedule).not.toHaveBeenCalled();
});
it('removes upstream updater endpoints and does not register a plugin download path',()=>{
 const config=JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json',import.meta.url),'utf8'));
 expect(config.plugins.updater).toBeUndefined();expect(config.bundle.createUpdaterArtifacts).toBe(false);
 const native=readFileSync(new URL('../../src-tauri/src/main.rs',import.meta.url),'utf8');expect(native).not.toContain('tauri_plugin_updater::');expect(native).not.toContain('download_and_install');
 const sidecar=readFileSync(new URL('../sidekick.mjs',import.meta.url),'utf8');expect(sidecar).toContain("const UPDATE_REPO = 'danielma-hash/Roamies'");
});

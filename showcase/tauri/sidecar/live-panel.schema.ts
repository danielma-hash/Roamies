import { z } from 'zod';
import {liveQuerySourceSchema} from './live-query.schema.js';
const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/);
const title = z.string().min(1).max(120);
const cell = z.union([z.string().max(500), z.number().finite().min(-1e12).max(1e12), z.boolean()]);
const field = z.strictObject({id,label:title,kind:z.enum(['text','select','toggle']),value:z.string().max(400).optional(),options:z.array(z.string().max(80)).max(12).optional()});
export const liveBlockSchema = z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('query'),id,title,source:liveQuerySourceSchema,query:z.string().max(120).optional()}),
 z.strictObject({kind:z.literal('text'),id,title,body:z.string().max(3000)}),
 z.strictObject({kind:z.literal('table'),id,title,columns:z.array(title).min(1).max(8),rows:z.array(z.array(cell).min(1).max(8)).max(60)}),
 z.strictObject({kind:z.literal('bar'),id,title,unit:z.string().max(30).optional(),points:z.array(z.strictObject({label:title,value:z.number().finite().min(0).max(1e12)})).min(1).max(20)}),
 z.strictObject({kind:z.literal('form'),id,title,fields:z.array(field).min(1).max(12)}),
 z.strictObject({kind:z.literal('board'),id,title,columns:z.array(z.strictObject({title,cards:z.array(z.strictObject({title,detail:z.string().max(400).optional()})).max(12)})).min(1).max(4)}),
 z.strictObject({kind:z.literal('flow'),id,title,nodes:z.array(z.strictObject({id,title})).min(1).max(12),edges:z.array(z.strictObject({from:id,to:id,label:z.string().max(80).optional()})).max(20)}),
]);
export const livePanelSpecSchema = z.strictObject({title,subtitle:z.string().max(300).optional(),sourceNote:z.string().max(600).optional(),blocks:z.array(liveBlockSchema).min(1).max(12)}).superRefine((panel,ctx)=>{
 if(new TextEncoder().encode(JSON.stringify(panel)).byteLength>48_000)ctx.addIssue({code:'custom',message:'המסך חורג מתקציב הנתונים.'});
 const ids=new Set<string>();const sources=new Set<string>();let nodes=0;
 for(const block of panel.blocks){
  if(ids.has(block.id))ctx.addIssue({code:'custom',message:'מזהה רכיב כפול.'});ids.add(block.id);nodes+=20;
  if(block.kind==='query'){nodes+=120;if(sources.has(block.source))ctx.addIssue({code:'custom',message:'כל מקור חי יכול להופיע פעם אחת במסך.'});sources.add(block.source);}
  if(block.kind==='table'){nodes+=block.rows.length*(block.columns.length*2+1)+block.columns.length*2+8;if(block.rows.some(row=>row.length!==block.columns.length))ctx.addIssue({code:'custom',message:'מספר התאים אינו מתאים לעמודות.'});}
  if(block.kind==='bar')nodes+=block.points.length*7;
  if(block.kind==='board')nodes+=block.columns.reduce((sum,col)=>sum+col.cards.length*6+4,0);
  if(block.kind==='form'){
   nodes+=block.fields.reduce((sum,field)=>sum+7+(field.options?.length??0)*2,0);const keys=new Set<string>();
   for(const f of block.fields){if(keys.has(f.id)||f.kind==='select'&&(!f.options?.length||f.value!==undefined&&!f.options.includes(f.value)))ctx.addIssue({code:'custom',message:'שדות הטופס אינם תקינים.'});keys.add(f.id);}
  }
  if(block.kind==='flow'){
   nodes+=block.nodes.length*4+block.edges.length*3;const keys=new Set(block.nodes.map(node=>node.id));
   if(keys.size!==block.nodes.length||block.edges.some(edge=>!keys.has(edge.from)||!keys.has(edge.to)||edge.from===edge.to))ctx.addIssue({code:'custom',message:'התרשים מפנה לצומת חסר או כפול.'});
  }
 }
 if(nodes>1000)ctx.addIssue({code:'custom',message:'המסך מכיל יותר מדי רכיבים.'});
});
export const livePanelEnvelopeSchema = z.strictObject({id:z.uuid(),revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime().optional(),spec:livePanelSpecSchema});

export const livePanelArchiveSchema = z.strictObject({
 version:z.literal(1), selectedId:z.uuid().optional(),
 panels:z.array(z.array(livePanelEnvelopeSchema).min(1).max(5)).max(20),
}).superRefine((archive,ctx)=>{
 const ids=new Set<string>();
 for(const history of archive.panels){
  const first=history[0]!;
  if(ids.has(first.id)||history.some((entry,i)=>entry.id!==first.id||entry.createdAt!==first.createdAt||i>0&&entry.revision!==history[i-1]!.revision+1))ctx.addIssue({code:'custom',message:'היסטוריית מסך אינה תקינה.'});
  ids.add(first.id);
 }
 if(archive.selectedId&&!ids.has(archive.selectedId))ctx.addIssue({code:'custom',message:'המסך הנבחר אינו קיים.'});
});

import { livePanelEnvelopeSchema } from './live-panel.schema.js';
import type { LiveBlock,LivePanelEnvelope } from './live-panel.types.js';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''):HTMLElementTagNameMap[K]=>{const node=document.createElement(tag);node.textContent=text;node.className=className;return node;};
const number=(value:number):string=>new Intl.NumberFormat('he-IL',{maximumFractionDigits:2}).format(value);
const cellText=(value:string|number|boolean):string=>typeof value==='number'?number(value):typeof value==='boolean'?value?'כן':'לא':value;
const svg=<K extends keyof SVGElementTagNameMap>(tag:K,attributes:Record<string,string>={},text=''):SVGElementTagNameMap[K]=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,value);node.textContent=text;return node;};

/** Closed component catalog. All model strings are text, never DOM markup or executable attributes. */
export class LivePanelView {
 private current?:LivePanelEnvelope;
 constructor(private readonly root:HTMLElement){root.classList.add('live-panel-root');root.append(el('h1','המסך הבא מתחיל בבקשה שלך'),el('p','אפשר לבקש מג׳ארוויס טבלת השוואה, גרף, לוח עבודה או תרשים.','freshness'));}
 receive(input:unknown):boolean {
  const parsed=livePanelEnvelopeSchema.safeParse(input);
  if(!parsed.success)return false;
  const panel=parsed.data;if(this.current?.id===panel.id&&this.current.revision===panel.revision)return false;
  this.current=panel;const header=el('header');const titles=el('div');titles.append(el('p','JARVIS / מסך עבודה','eyebrow'),el('h1',panel.spec.title));
  if(panel.spec.subtitle)titles.append(el('p',panel.spec.subtitle,'live-subtitle'));header.append(titles);
  const meta=el('p',`נוצר ב־${new Date(panel.createdAt).toLocaleString('he-IL')}`,'freshness');
  const grid=el('div','','live-grid');for(const block of panel.spec.blocks)grid.append(this.block(block,panel.id));
  const source=el('p',panel.spec.sourceNote??'המידע מוצג כפי שנמסר. המסך אינו מתרענן ממקור חיצוני.','live-source');
  this.root.replaceChildren(header,meta,grid,source);return true;
 }
 receipt():{id:string;revision:number}|undefined{return this.current?{id:this.current.id,revision:this.current.revision}:undefined;}
 private block(block:LiveBlock,panelId:string):HTMLElement {
  const section=el('section','',`live-block live-${block.kind}`);section.dataset.block=block.id;
  const heading=el('h2',block.title);heading.id=`live-${panelId}-${block.id}`;section.setAttribute('aria-labelledby',heading.id);section.append(heading);
  if(block.kind==='text')section.append(el('p',block.body,'live-copy'));
  if(block.kind==='table')this.table(section,block);
  if(block.kind==='bar'){
   const max=Math.max(1,...block.points.map(point=>point.value));const list=el('ul','','live-bars');
   for(const point of block.points){const row=el('li');const label=el('span',point.label);label.dir='auto';const value=el('strong',`${number(point.value)} ${block.unit??''}`);const bar=el('progress');bar.max=max;bar.value=point.value;bar.setAttribute('aria-label',`${point.label}: ${number(point.value)} ${block.unit??''}`);row.append(label,value,bar);list.append(row);}section.append(list);
  }
  if(block.kind==='form')this.form(section,block,panelId);
  if(block.kind==='board'){
   const board=el('div','','live-board');for(const column of block.columns){const lane=el('section','','live-lane');lane.append(el('h3',`${column.title} · ${column.cards.length}`));for(const card of column.cards){const item=el('article','','live-card');item.append(el('h4',card.title));if(card.detail)item.append(el('p',card.detail));lane.append(item);}board.append(lane);}section.append(board);
  }
  if(block.kind==='flow')this.flow(section,block,panelId);
  return section;
 }
 private table(section:HTMLElement,block:Extract<LiveBlock,{kind:'table'}>):void {
  const search=el('input');search.type='search';search.placeholder='סינון הטבלה';search.maxLength=100;search.setAttribute('aria-label',`סינון ${block.title}`);search.dir='auto';
  const scroller=el('div','','live-table-scroll');const table=el('table');const head=el('thead');const row=el('tr');for(const title of block.columns){const cell=el('th',title);cell.scope='col';cell.dir='auto';row.append(cell);}head.append(row);
  const body=el('tbody');table.append(head,body);scroller.append(table);const count=el('p','','freshness');count.setAttribute('role','status');
  const render=():void=>{const query=search.value.toLocaleLowerCase();const rows=block.rows.filter(values=>values.some(value=>cellText(value).toLocaleLowerCase().includes(query)));body.replaceChildren();for(const values of rows){const row=el('tr');for(const value of values){const cell=el('td',cellText(value));cell.dir='auto';row.append(cell);}body.append(row);}count.textContent=`${rows.length} מתוך ${block.rows.length} שורות`;};
  search.addEventListener('input',render);section.append(search,scroller,count);render();
 }
 private form(section:HTMLElement,block:Extract<LiveBlock,{kind:'form'}>,panelId:string):void {
  const form=el('form');const inputs=new Map<string,HTMLInputElement|HTMLSelectElement>();
  for(const field of block.fields){
   const label=el('label',field.label,'live-field');const input=field.kind==='select'?el('select'):el('input');input.id=`form-${panelId}-${block.id}-${field.id}`;label.htmlFor=input.id;input.name=field.id;input.dir='auto';
   if(input instanceof HTMLSelectElement){for(const value of field.options??[]){const option=el('option',value);option.value=value;input.append(option);}input.value=field.value??field.options?.[0]??'';}
   else if(field.kind==='toggle'){input.type='checkbox';input.checked=field.value==='true';label.classList.add('live-toggle');}
   else{input.type='text';input.maxLength=400;input.value=field.value??'';}
   inputs.set(field.id,input);label.append(input);form.append(label);
  }
  const preview=el('button','תצוגה מקדימה');preview.type='submit';const result=el('div','','live-form-preview');result.setAttribute('role','status');
  form.addEventListener('submit',event=>{event.preventDefault();result.replaceChildren(...block.fields.map(field=>{const input=inputs.get(field.id)!;const value=input instanceof HTMLInputElement&&input.type==='checkbox'?(input.checked?'כן':'לא'):input.value;return el('p',`${field.label}: ${value||'לא נבחר'}`);}));});
  form.append(preview,el('p','הבחירות נשארות במסך הזה ואינן מפעילות פעולה.','freshness'),result);section.append(form);
 }
 private flow(section:HTMLElement,block:Extract<LiveBlock,{kind:'flow'}>,panelId:string):void {
  const rows=Math.ceil(block.nodes.length/3);const height=rows*110;const image=svg('svg',{viewBox:`0 0 600 ${height}`,role:'img','aria-label':block.title,class:'live-flow-image'});
  const markerId=`arrow-${panelId}-${block.id}`;const defs=svg('defs');const marker=svg('marker',{id:markerId,viewBox:'0 0 10 10',refX:'9',refY:'5',markerWidth:'7',markerHeight:'7',orient:'auto-start-reverse'});marker.append(svg('path',{d:'M 0 0 L 10 5 L 0 10 z',class:'live-flow-arrow'}));defs.append(marker);image.append(defs);
  const positions=new Map(block.nodes.map((node,i)=>[node.id,{x:500-(i%3)*200,y:45+Math.floor(i/3)*110}]));
  for(const edge of block.edges){const from=positions.get(edge.from)!,to=positions.get(edge.to)!;const dx=to.x-from.x,dy=to.y-from.y;const trim=Math.min(85/Math.max(Math.abs(dx),1e-9),33/Math.max(Math.abs(dy),1e-9));image.append(svg('line',{x1:String(from.x+dx*trim),y1:String(from.y+dy*trim),x2:String(to.x-dx*trim),y2:String(to.y-dy*trim),'marker-end':`url(#${markerId})`,class:'live-flow-edge'}));}
  for(const node of block.nodes){const at=positions.get(node.id)!;const group=svg('g');group.append(svg('rect',{x:String(at.x-82),y:String(at.y-30),width:'164',height:'60',rx:'12',class:'live-flow-node'}),svg('text',{x:String(at.x),y:String(at.y+5),'text-anchor':'middle',class:'live-flow-label'},node.title.length>24?`${node.title.slice(0,23)}…`:node.title));image.append(group);}
  const connections=el('ul','','live-connections');for(const edge of block.edges){const from=block.nodes.find(node=>node.id===edge.from)!,to=block.nodes.find(node=>node.id===edge.to)!;connections.append(el('li',`${from.title} ← ${to.title}${edge.label?`: ${edge.label}`:''}`));}section.append(image,connections);
 }
}

import type { AsmMemoryCitation } from './asm-memory.types.js';
export interface KnowledgeState { readonly citations?:readonly AsmMemoryCitation[]; readonly busy?:boolean }
export function renderKnowledgeWorkspace(state:KnowledgeState,send:(message:unknown)=>void):HTMLElement {
  const root=document.createElement('section');root.className='workspace';root.dir='rtl';
  const title=document.createElement('h2');title.textContent='הזיכרון המשותף · ASM';root.append(title);
  const form=document.createElement('form');form.className='workspace-search';
  const query=document.createElement('input');query.type='search';query.placeholder='מה תרצה למצוא בזיכרון?';query.setAttribute('aria-label','חיפוש בזיכרון המשותף');query.maxLength=200;query.required=true;
  const scope=document.createElement('select');scope.setAttribute('aria-label','תחום הזיכרון');for(const [value,label]of[['company','פרויקטי החברה'],['personal','פרויקטים אישיים']]){const option=document.createElement('option');option.value=value;option.textContent=label;scope.append(option);}
  const submit=document.createElement('button');submit.className='workspace-button';submit.textContent='חיפוש ב־ASM';submit.disabled=!!state.busy;
  form.append(query,scope,submit);form.addEventListener('submit',event=>{event.preventDefault();send({type:'workspace',action:'memory.search',query:query.value,scope:scope.value});});root.append(form);
  const note=document.createElement('p');note.className='workspace-description';note.textContent='מקורות מקומיים עם תאריך. מידע היסטורי דורש אימות לפני פעולה; Anna ו־Gather מופרדים מפרויקטי החברה.';root.append(note);
  if(state.citations?.length===0){const empty=document.createElement('p');empty.textContent='לא נמצאו מקורות בתחום שנבחר.';root.append(empty);}
  for(const citation of state.citations??[]){const card=document.createElement('article');card.className='workspace-session';card.dataset.userContent='';const heading=document.createElement('h3');heading.textContent=citation.title;heading.dir='auto';const text=document.createElement('p');text.textContent=citation.excerpt;text.dir='auto';const source=document.createElement('p');source.className='workspace-description';source.textContent=`${citation.source} · ${citation.date??'תאריך לא ידוע'} · ${citation.path}`;source.dir='auto';card.append(heading,text,source);root.append(card);}return root;
}

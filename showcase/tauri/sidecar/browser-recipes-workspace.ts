import type { ProjectRecipe, RecipesWorkspaceAction, RecipesWorkspaceState } from './project-recipes.types.js';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderRecipesWorkspace(state: RecipesWorkspaceState, send: (message: RecipesWorkspaceAction) => void): HTMLElement {
  const root = element('section', 'workspace workspace-recipes'); root.dir = 'rtl'; root.lang = 'he';
  root.setAttribute('aria-label', 'מתכוני עבודה'); root.setAttribute('aria-busy', String(Boolean(state.busy)));
  root.append(element('h2', 'workspace-title', 'מתכוני עבודה'),
    element('p', 'workspace-description', 'בחירת מתכון מציגה את התכנית. רק לחיצה על הפעלה שולחת בקשה ל־Jarvis.'));
  if (state.error || state.message || state.busy) {
    const feedback = element('p', 'workspace-feedback', state.error || (state.busy ? 'מכין את הבקשה…' : state.message));
    feedback.setAttribute('role', state.error ? 'alert' : 'status'); root.append(feedback);
  }
  const choices = element('div', 'workspace-actions'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', 'בחירת מתכון');
  const preview = element('section', 'workspace-detail'); preview.setAttribute('aria-label', 'תכנית העבודה לפני הפעלה');
  const choiceButtons = new Map<string, HTMLButtonElement>();
  const select = (recipe: ProjectRecipe): void => {
    for (const [id, choice] of choiceButtons) choice.setAttribute('aria-pressed', String(id === recipe.id));
    preview.replaceChildren(element('h3', 'workspace-detail-title', recipe.title),
      element('p', 'workspace-description', recipe.description), element('p', 'workspace-note', recipe.scope));
    const project = element('p', 'workspace-session-project', recipe.defaultProjectPath); project.dir = 'auto'; project.dataset.userContent = ''; preview.append(project);
    const steps = element('ol', 'workspace-recipe-steps');
    for (const step of recipe.steps) {
      const item = element('li', 'workspace-message');
      item.append(element('h4', 'workspace-message-role', step.title), element('p', 'workspace-message-text', step.instruction),
        element('p', 'workspace-note', `ראיה נדרשת: ${step.expectedEvidence}`)); steps.append(item);
    }
    preview.append(steps, element('h4', 'workspace-message-role', 'מה נבדוק לפני הסיום'));
    const verification = element('ul', 'workspace-recipe-verification');
    for (const check of recipe.verification) verification.append(element('li', 'workspace-note', check));
    preview.append(verification, element('h4', 'workspace-message-role', 'גבולות ההרצה'));
    const boundaries = element('ul', 'workspace-recipe-boundaries');
    for (const boundary of recipe.boundaries) boundaries.append(element('li', 'workspace-note', boundary));
    const run = element('button', 'workspace-button', 'הפעלת המתכון בקריאה בלבד');
    run.type = 'button'; run.disabled = Boolean(state.busy);
    run.addEventListener('click', () => {
      run.disabled = true;
      send({ type: 'workspace', action: 'recipes.run', id: recipe.id });
    });
    preview.append(boundaries, run);
  };
  for (const recipe of state.recipes) {
    const choice = element('button', 'workspace-button', recipe.title); choice.type = 'button'; choice.disabled = Boolean(state.busy);
    choice.addEventListener('click', () => select(recipe)); choiceButtons.set(recipe.id, choice); choices.append(choice);
  }
  root.append(choices, preview);
  if (state.recipes[0]) select(state.recipes[0]);
  else preview.append(element('p', 'workspace-empty', 'אין מתכוני עבודה זמינים.'));
  return root;
}

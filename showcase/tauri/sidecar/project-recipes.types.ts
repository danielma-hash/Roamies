export type ProjectRecipeId = 'vocaly-review' | 'ordico-task-plan' | 'end-of-day';

export interface ProjectRecipeStep {
  readonly title: string;
  readonly instruction: string;
  readonly expectedEvidence: string;
}

export interface ProjectRecipe {
  readonly id: ProjectRecipeId;
  readonly title: string;
  readonly description: string;
  readonly scope: string;
  readonly defaultProjectPath: string;
  readonly steps: readonly ProjectRecipeStep[];
  readonly verification: readonly string[];
  readonly boundaries: readonly string[];
}

export interface PreparedProjectRecipe {
  readonly recipe: ProjectRecipe;
  readonly projectPath: string;
  readonly prompt: string;
}

export interface RecipesWorkspaceState {
  readonly recipes: readonly ProjectRecipe[];
  readonly busy?: boolean;
  readonly message?: string;
  readonly error?: string;
}

export interface RecipesWorkspaceAction {
  readonly type: 'workspace';
  readonly action: 'recipes.run';
  readonly id: ProjectRecipeId;
}

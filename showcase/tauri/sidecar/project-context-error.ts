export class ProjectContextError extends Error {
  constructor(detail: string) {
    super(`טעינת הוראות הפרויקט נכשלה: ${detail}. הסשן לא נפתח.`);
    this.name = 'ProjectContextError';
  }
}

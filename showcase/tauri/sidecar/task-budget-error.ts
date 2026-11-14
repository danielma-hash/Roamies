import type { TaskBudgetReason } from './task-budget.types.js';
const labels: Readonly<Record<TaskBudgetReason, string>> = {
  time: 'מגבלת הזמן', tools: 'מגבלת קריאות הכלים', screenshots: 'מגבלת צילומי המסך', tokens: 'מגבלת הטוקנים המדווחים', no_progress: 'קריאה חוזרת ללא שינוי בתוצאה',
};
export class TaskBudgetError extends Error {
  constructor(readonly reason: TaskBudgetReason) {
    super(`הבקשה נעצרה: ${labels[reason]}. ההתקדמות נשמרה; יש לבדוק מה כבר בוצע לפני המשך.`);
    this.name = 'TaskBudgetError';
  }
}

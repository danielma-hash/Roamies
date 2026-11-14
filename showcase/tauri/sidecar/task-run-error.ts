export class TaskRunError extends Error {
  constructor(message = 'לא ניתן לשמור את התקדמות המשימה. הביצוע נעצר; יש לבדוק מה כבר בוצע לפני ניסיון נוסף.') {
    super(message); this.name = 'TaskRunError';
  }
}

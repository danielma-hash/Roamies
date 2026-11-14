export class PanelActionError extends Error {
 constructor(){super('התצוגה השתנתה, פגה או לא אושרה מהחלון. יש לקרוא מחדש את הקשר המסך; אין לנחש יעד לפי המספר.');this.name='PanelActionError';}
}

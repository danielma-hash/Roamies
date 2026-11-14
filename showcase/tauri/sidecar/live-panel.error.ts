export class LivePanelError extends Error {
 constructor(readonly code:'storage'|'conflict'|'limit'|'missing'){
  const messages={
   storage:'לא ניתן לקרוא או לשמור את המסכים. הקובץ נשמר ללא איפוס; יש לתקן את השמירה לפני שינוי נוסף.',
   conflict:'המסך השתנה מאז הקריאה האחרונה. יש לקרוא אותו שוב לפני עדכון.',
   limit:'נשמרו כבר 20 מסכים. אפשר לעדכן מסך קיים; לא נמחקו מסכים אוטומטית.',
   missing:'המסך המבוקש אינו שמור בפרופיל הזה.',
  };
  super(messages[code]);this.name='LivePanelError';
 }
}

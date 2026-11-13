# Soniox ו־Cartesia במק

גרסה מותאמת של Roamies: זיהוי דיבור ב־Soniox `stt-rt-v6` ודיבור ב־Cartesia `sonic-3.6` בעברית.
ברירת המחדל היא Oren. בהגדרות הקול אפשר לבחור חמישה קולות גבריים וחמישה נשיים ולהאזין לדוגמה.
המפתחות נשמרים ב־macOS Keychain באמצעות אותו מנגנון מוצפן של האפליקציה, בנפרד: `soniox` ו־`cartesia`.
אין צורך במפתח Fish Audio או בהרשאת זיהוי הדיבור של Apple. עדיין נדרשת הרשאת מיקרופון.

ההאזנה פועלת בהחזקה או בלחיצה על קיצור הדיבור. Wake word אינו פעיל בגרסה הזו; לא נשלח אודיו רציף מהחדר לענן.
העדכון האוטומטי מהפרויקט המקורי חסום במק כדי שלא יחליף את המנועים המותאמים.
ההתאמה של Soniox מתייחסת למק בלבד; מנגנון ההאזנה המקורי ב־Windows וב־Linux נשאר כפי שהיה.

## בנייה ובדיקה

```sh
cd showcase/tauri/sidecar
npm ci
npm test
cd ..
./build.sh dev
./sidecar/node_modules/.bin/tauri build --debug --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

האפליקציה נמצאת ב־`src-tauri/target/debug/bundle/macos/Roamies.app`.
מנועי הקול ב־TypeScript strict. עוזר Swift מטפל במיקרופון ומעביר PCM בתעלה מקומית למנוע Soniox.
Cartesia מזרים PCM ישירות למסלול השמעת האודיו הקיים. עצירה מבטלת בקשות ומונעת אודיו מתור קודם.

מקורות API: [Soniox WebSocket](https://docs.soniox.com/api-reference/stt/websocket-api),
[Cartesia TTS](https://docs.cartesia.ai/api-reference/tts/bytes). מפתח Soniox נשלח בכותרת Authorization,
ומפתח Cartesia נשלח רק ל־Cartesia עם גרסת API `2026-08-14`.

בדיקות אוטומטיות מכסות PCM, סדר משפטים, עצירה, שגיאות, partial/final של Soniox, סיום הזרם וקטלוג 10 הקולות.
בוצעה גם בדיקת Cartesia→Soniox חיה בעברית; בדיקה זו אינה תחליף לשיחה של המשתמש במיקרופון האמיתי.

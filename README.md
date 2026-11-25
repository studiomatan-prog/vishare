# VISHARE

אורחים מצלמים את הזוג מהטלפון דרך לינק, בלי אפליקציה. הסרטונים נשמרים ב־Cloudflare R2, והעריכה האוטומטית מכינה מהם סרטונים לפי רגעים.
מבית LOCO GROUP.

## מה יש כאן

| נתיב | מה זה |
|---|---|
| `public/index.html` | אתר המכירה (vishare.co.il) |
| `public/guest.html`, `public/guest.js` | דף האורח (vishare.co.il/e/&lt;שם-האירוע&gt;) |
| `public/admin.html`, `public/admin.js` | ממשק הניהול של LOCO (vishare.co.il/admin) |
| `worker/src/index.js` | השרת: API לאורחים ולניהול |
| `worker/src/sigv4.js` | חתימה של קישורי העלאה ישירה ל־R2 |
| `supabase/schema.sql` | מבנה בסיס הנתונים |
| `r2-cors.json` | הרשאת העלאה מהדפדפן ל־R2 |
| `test/smoke.mjs` | בדיקה של כל ה־API (`node test/smoke.mjs`) |

## הקמה (פעם אחת)

1. **Supabase:** SQL Editor ← New query ← להדביק את `supabase/schema.sql` ← Run.
2. **R2 CORS:** ב־Cloudflare ← R2 ← vishare-videos ← Settings ← CORS Policy ← להדביק את `r2-cors.json`.
3. **מפתח R2:** R2 ← Manage API tokens ← Create token ← Object Read & Write, רק ל־vishare-videos.
4. **סודות לשרת** (מהמחשב, בתיקיית הפרויקט):
   ```
   npx wrangler login
   npx wrangler secret put SUPABASE_SERVICE_KEY
   npx wrangler secret put R2_ACCESS_KEY_ID
   npx wrangler secret put R2_SECRET_ACCESS_KEY
   npx wrangler secret put ADMIN_TOKEN
   ```
5. **העלאה לאוויר:** `npx wrangler deploy`

סודות לא נשמרים בקוד ולא נשלחים בצ'אט.

## יצירת אירוע

בממשק הניהול: vishare.co.il/admin ← כניסה עם ה־ADMIN_TOKEN ← "אירוע חדש".

או בפקודה:

```
curl -X POST https://vishare.co.il/api/admin/events \
  -H "authorization: Bearer <ADMIN_TOKEN>" -H "content-type: application/json" \
  -d '{"slug":"dana-david","couple_names":"דנה ודוד","event_date":"2026-12-10","venue":"אולמי אגמים"}'
```

התשובה כוללת את הלינק לאורחים ואת הלינק הפרטי לזוג. ההעלאה נסגרת כברירת מחדל יומיים אחרי האירוע ב־20:00.

# SpeakUp AI

شبیه‌ساز مکالمهٔ حرفه‌ایِ زبان انگلیسی + مربی صوتی، ساخته‌شده با Next.js.
نقش پیمانکار، مدیر، کارفرما یا مصاحبه‌کننده را بازی می‌کند و با انگلیسی محیط‌کارِ استرالیایی صحبت می‌کند.

این نسخه روی **Firefox، Chrome، Edge و موبایل** کار می‌کند، چون ورودی صوتی به‌جای Web Speech مرورگر، از `MediaRecorder` + Whisper سمت سرور استفاده می‌کند.

---

## ۱) پیش‌نیازها

- **Node.js نسخهٔ ۱۸ یا بالاتر** (نسخهٔ ۲۰ پیشنهاد می‌شود) — از https://nodejs.org نصب کن.
- یک **OpenAI API key** از https://platform.openai.com/api-keys

برای بررسی نصب بودن Node:

```bash
node -v
```

---

## ۲) نصب

داخل پوشهٔ پروژه:

```bash
npm install
```

---

## ۳) تنظیم کلید API

فایل `.env.local.example` را کپی کن به `.env.local`:

```bash
cp .env.local.example .env.local
```

سپس داخل `.env.local` کلید واقعی‌ات را بگذار:

```
OPENAI_API_KEY=sk-...
```

کلید فقط روی سرور استفاده می‌شود و هیچ‌وقت به مرورگر فرستاده نمی‌شود.

اختیاری:
- مدل‌ها: `GEMINI_MODEL`، `GPT4O_MODEL`، `CLAUDE_SONNET_MODEL`، `GPT55_MODEL`، `OPENAI_FALLBACK_MODEL` (هیچ نام مدلی در کد hardcode نیست)
- کلیدها: `OPENAI_API_KEY` (لازم)، `GEMINI_API_KEY` و `ANTHROPIC_API_KEY` (اختیاری — تا وقتی نباشند، آن tierها خودکار به OpenAI fallback می‌کنند)
- `OPENAI_TTS_VOICE` — صدای خوانش (پیش‌فرض `onyx`؛ گزینه‌ها: alloy, echo, fable, onyx, nova, shimmer)

---

## ۴) اجرا روی همین سیستم

```bash
npm run dev
```

بعد مرورگر را باز کن:

```
http://localhost:3000
```

روی **Firefox یا Chrome** کار می‌کند. بار اول که میکروفون را بزنی، مرورگر اجازه می‌خواهد.

### بررسی سلامت (اگر چیزی کار نکرد، اول این)
این آدرس را در مرورگر باز کن:

```
http://localhost:3000/api/health
```

اگر `"ok": true` دیدی، کلید درست است و chat + صدا باید کار کنند.
اگر `"ok": false` بود، پیام داخلش دقیقاً می‌گوید مشکل کجاست (کلید نیست / کلید رد شد / billing فعال نیست).

> بعد از تغییر `.env.local` حتماً سرور را با Ctrl+C ببند و دوباره `npm run dev` بزن — متغیر محیطی فقط موقع شروع خوانده می‌شود.

---

## ۵) اجرا روی موبایل (همان شبکهٔ Wi-Fi)

۱. مطمئن شو کامپیوتر و موبایل به یک Wi-Fi وصل‌اند.
۲. آدرس IP محلی کامپیوتر را پیدا کن:
   - **مک / لینوکس:** `ipconfig getifaddr en0`  یا  `hostname -I`
   - **ویندوز:** `ipconfig` (دنبال IPv4 Address بگرد، چیزی مثل `192.168.1.20`)
۳. سرور را روی همهٔ اینترفیس‌ها اجرا کن:

```bash
npm run dev -- -H 0.0.0.0
```

۴. در مرورگر موبایل برو به:

```
http://192.168.1.20:3000
```

(عدد را با IP خودت عوض کن.)

> ⚠️ نکتهٔ میکروفون روی موبایل: مرورگرها فقط روی `localhost` یا `https` اجازهٔ میکروفون می‌دهند.
> چون آدرس بالا `http` و با IP است، **ضبط صدا روی موبایل ممکن است کار نکند** ولی تایپ‌کردن و شنیدن صدا (TTS) کار می‌کند.
> برای اینکه میکروفون روی موبایل هم کامل کار کند، از روش زیر (دیپلوی روی اینترنت با https) یا یک تونل مثل `ngrok` استفاده کن:
>
> ```bash
> npx ngrok http 3000
> ```
> سپس آدرس `https://...ngrok...` را روی موبایل باز کن.

---

## ۶) دیپلوی روی اینترنت (پیشنهادی برای موبایل)

راهنمای کامل و قدم‌به‌قدم در فایل **`DEPLOY-fa.md`** هست (هم روش GitHub، هم روش ترمینال با Vercel CLI).

خلاصه: پروژه را روی Vercel دیپلوی می‌کنی، `OPENAI_API_KEY` را در Environment Variables وارد می‌کنی، و یک آدرس `https://...` می‌گیری که روی موبایل با میکروفونِ کامل کار می‌کند و می‌توانی به صفحهٔ اصلی گوشی پین‌اش کنی.

---

## ساختار پروژه

```
speakup/
├─ app/
│  ├─ page.tsx              ← کل رابط کاربری (Client Component)
│  ├─ layout.tsx            ← فونت‌ها و قالب کلی
│  ├─ globals.css           ← استایل سراسری
│  └─ api/
│     ├─ chat/route.ts      ← گفت‌وگوی AI (OpenAI Chat)
│     ├─ transcribe/route.ts← صدا → متن (Whisper)
│     └─ speak/route.ts     ← متن → صدا (OpenAI TTS)
├─ lib/
│  ├─ prompts.ts            ← کل منطق system prompt و مودها (جداست)
│  ├─ storage.ts            ← Error Bank و Speaking DNA در localStorage
│  └─ types.ts              ← تایپ‌های مشترک
├─ .env.local.example
└─ package.json
```

منطق پرامپت کاملاً در `lib/prompts.ts` جدا شده؛ برای تغییر رفتار مودها فقط همان فایل را ویرایش کن.

---

## مودها و دستورها

**مودها:** Realistic، Coach Silver، Coach Titanium، Coach Gold — فقط یک مود در هر لحظه فعال است.
- **Realistic** — تمرین روزمره، کم‌هزینه‌ترین (همه‌چیز روی Gemini).
- **Coach Silver / Titanium / Gold** — مربیِ حرفه‌ای با نمره، اصلاح، Natural Version، Coach Note و Options بعد از هر پیام. کیفیتِ roleplay در هر tier بالاتر می‌رود (Silver=GPT-4o، Titanium=Claude Sonnet، Gold=GPT-5.5).

**دستورها** (در کادر چت تایپ کن یا دکمه‌های سریع را بزن):

| دستور | کار |
|------|-----|
| `/options` | ۵ نسخه: کوتاه/روان/حرفه‌ای/قاطع/دیپلماتیک |
| `/harder` `/easier` | تغییر سطح سختی |
| `/save` | ذخیرهٔ اشتباه در Error Bank |
| `/mode` | نمایش مود فعال |
| `/end` | پایان و فیدبک جلسه (Top Mistakes + Useful Phrases) |
| `/dna` | نمایش Speaking DNA |
| `/shadowing` | تمرین shadowing با دکمهٔ پخش صوتی |

**پنل Help:** دکمهٔ «? Help» بالای صفحهٔ چت یک دستیار جدا باز می‌کند (ترجمه، توضیح کلمه، سؤال ارتباطی) که هیچ دخالتی در roleplay ندارد.

**Coach tiers:** بعد از هر سؤالِ نقشِ مقابل، یک «Coach note» کوتاه می‌بینی که از اصول مذاکره و ارتباط (Never Split the Difference, Getting to Yes, Influence و …) الهام گرفته. در Realistic فیدبک فقط در پایان است.

داده‌های Error Bank و Speaking DNA در مرورگر (localStorage) ذخیره می‌شوند و بین جلسه‌ها باقی می‌مانند.
```

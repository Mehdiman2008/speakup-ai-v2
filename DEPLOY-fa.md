# راهنمای دیپلوی SpeakUp AI روی اینترنت (Vercel)

با این کار یک آدرس `https://...` می‌گیری که:
- روی موبایل با **میکروفونِ کامل** کار می‌کند (چون https است)،
- از هر جایی قابل دسترسی است،
- می‌توانی به صفحهٔ اصلی موبایل پین‌اش کنی مثل یک اپ.

دیپلوی Next.js روی Vercel **بدون هیچ تنظیم اضافه** است؛ Vercel خودش framework را تشخیص می‌دهد.

---

## روش A — از طریق GitHub (پیشنهادی، گرافیکی)

### قدم ۱: کد را روی GitHub بگذار
اگر هنوز روی GitHub نیست:

```bash
cd speakup
git init
git add .
git commit -m "SpeakUp AI"
```

بعد در https://github.com/new یک ریپو خالی بساز (مثلاً `speakup-ai`) و دستورهایی که GitHub نشان می‌دهد را اجرا کن — چیزی شبیه:

```bash
git remote add origin https://github.com/USERNAME/speakup-ai.git
git branch -M main
git push -u origin main
```

> فایل `.env.local` به‌خاطر `.gitignore` آپلود نمی‌شود — این درست است، کلید نباید روی GitHub برود.

### قدم ۲: در Vercel پروژه بساز
1. برو به https://vercel.com و با همان حساب GitHub وارد شو.
2. روی **Add New… → Project** بزن.
3. ریپوی `speakup-ai` را **Import** کن.
4. در صفحهٔ تنظیمات، سه فیلد `Framework Preset` / `Build Command` / `Output Directory` را **دست نزن** — خودش روی Next.js درست پر شده.

### قدم ۳: کلید API را وارد کن (مهم‌ترین قدم)
قبل از زدن Deploy، بخش **Environment Variables** را باز کن و این را اضافه کن:

| Key | Value |
|-----|-------|
| `OPENAI_API_KEY` | `sk-...` (کلید واقعی‌ات) |

اختیاری (اگر خواستی):
| Key | Value |
|-----|-------|
| `OPENAI_CHAT_MODEL` | `gpt-4o-mini` |
| `OPENAI_TTS_VOICE` | `onyx` |

> ⚠️ روی `OPENAI_API_KEY` پیشوند `NEXT_PUBLIC_` **نگذار**. بدون این پیشوند، کلید فقط روی سرور می‌ماند و امن است.

### قدم ۴: Deploy
دکمهٔ **Deploy** را بزن. حدود یک دقیقه بعد یک آدرس می‌گیری مثل:

```
https://speakup-ai.vercel.app
```

همین آدرس را روی موبایل باز کن. ✅

---

## روش B — از طریق ترمینال (Vercel CLI)

اگر نمی‌خواهی با GitHub کار کنی:

```bash
npm i -g vercel        # نصب CLI
cd speakup
vercel login           # ورود (ایمیلت را تأیید کن)
vercel                 # چند سؤال ساده؛ همه را Enter بزن
```

بعد از اولین دیپلوی، کلید را اضافه کن و دوباره برای production دیپلوی کن:

```bash
vercel env add OPENAI_API_KEY production
# مقدار sk-... را paste کن

vercel --prod
```

آدرس production در خروجی چاپ می‌شود.

---

## افزودن به صفحهٔ اصلی موبایل (مثل یک اپ)

- **iOS / Safari:** آدرس را باز کن → دکمهٔ Share → **Add to Home Screen**.
- **Android / Chrome:** منوی سه‌نقطه → **Add to Home screen** (یا **Install app**).

حالا یک آیکن SpeakUp روی گوشی داری که تمام‌صفحه باز می‌شود.

---

## رفع اشکال‌های رایج

**۵۰۰ یا «API key not set» بعد از دیپلوی:**
احتمالاً `OPENAI_API_KEY` را در Vercel وارد نکرده‌ای، یا بعد از وارد کردن **دوباره دیپلوی نکرده‌ای**. متغیر محیطی فقط روی دیپلویِ بعدی اعمال می‌شود. در Vercel برو به Deployments → روی آخری → **Redeploy**.

**میکروفون روی موبایل کار نمی‌کند:**
باید آدرس `https` باشد (آدرس Vercel هست). اگر هنوز اجازه نداد، در تنظیمات مرورگر اجازهٔ میکروفون برای آن سایت را روشن کن.

**صدا (TTS) پخش نمی‌شود روی iOS:**
iOS گاهی برای پخش خودکار صدا اجازهٔ تعامل کاربر می‌خواهد. کافی است یک‌بار روی صفحه ضربه بزنی؛ بعد از آن صداها پخش می‌شوند.

**هزینه:**
استفاده از OpenAI API هزینهٔ مصرفی دارد (chat + Whisper + TTS). برای استفادهٔ شخصی معمولاً ناچیز است، ولی در داشبورد OpenAI می‌توانی سقف خرج (usage limit) بگذاری.

**Build fail شد:**
در لاگ‌های Vercel معمولاً علتش مشخص است. اگر به مشکل وابستگی خوردی، در تنظیمات پروژه Build Command را به `npm ci && next build` تغییر بده.

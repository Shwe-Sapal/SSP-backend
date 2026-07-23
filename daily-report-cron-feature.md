# နေ့စဉ် အရောင်းအစီရင်ခံစာ Cron Job အင်္ဂါရပ်

## ရည်ရွယ်ချက်

နေ့စဉ် ညနေ ၉ နာရီတွင် အလိုအလျောက် အရောင်းအစီရင်ခံစာ ထုတ်ပေးရန်။

## ဖိုင်ဖွဲ့စည်းပုံ

```
📁 autoshopbackend
├── 📄 src/services/dailyReportCron.service.js   ← Cron job ပင်မ လုပ်ဆောင်ချက်
├── 📄 src/server.js                              ← Cron ကို စတင်ရန် ချိတ်ဆက်ထားသော ဖိုင်
├── 📄 package.json                               ← node-cron dependency
```

## ထည့်သွင်းထားသော Package

```
npm install node-cron
```

## လုပ်ဆောင်ပုံ အဆင့်ဆင့်

### ၁။ Cron Job စတင်ခြင်း (`src/server.js`)

```javascript
// server.js တွင် အောက်ပါအတိုင်း ချိတ်ဆက်ထား
import { startDailyReportCron } from "./services/dailyReportCron.service.js";

app.listen(port, () => {
  startDailyReportCron();  // Server စပြီးနောက် cron ကို စတင်သည်
});
```

Server စတင်သည်နှင့် `[DailyReportCron] Scheduled for 9:00 PM daily.` ဟု Console တွင် ပြသလိမ့်မည်။

### ၂။ နေ့စဉ် ညနေ ၉ နာရီတွင် (`src/services/dailyReportCron.service.js`)

Cron Job သည် အောက်ပါ လုပ်ဆောင်ချက်များကို အလိုအလျောက် လုပ်ဆောင်သည်:

```
1. getSaleReportSummary() ကိုခေါ်သည်    → စုစုပေါင်းရောင်းအား၊ လျှော့စျေး၊ အော်ဒါအရေအတွက်
2. getPaymentMethodReport() ကိုခေါ်သည်  → ကဒ်/Mobile Banking နှင့် Cash ပေးချေမှုပမာဏ
3. getProductSalesReport() ကိုခေါ်သည်    → ရောင်းရသည့် ပစ္စည်းအရေအတွက်
4. ရလဒ်များကို မြန်မာလို စာသားအဖြစ် ပြောင်းလဲသည်
5. sendNotificationToAdmin() ကိုခေါ်သည် → အသိပေးစာ ပို့သည်
```

## အသုံးပြုထားသော Utility Functions

### toMyanmarDigits(num)

အင်္ဂလိပ်ဂဏန်းများကို မြန်မာဂဏန်းများသို့ ပြောင်းလဲပေးသည်။

| အင်္ဂလိပ် | မြန်မာ |
|-----------|---------|
| 0 | ၀ |
| 1 | ၁ |
| 123 | ၁၂၃ |
| 4567 | ၄၅၆၇ |

### formatMyanmarCurrency(amount)

ငွေပမာဏများကို မြန်မာ့ငွေကြေးပုံစံသို့ ပြောင်းလဲပေးသည်။

| ကိန်းဂဏန်း | မြန်မာလိုပုံစံ |
|-------------|----------------|
| 0 | ၀ ကျပ် |
| 100,000 | တစ်သိန်းကျပ် |
| 5,400,000 | ၅၄ သိန်းကျပ် |
| 8,060,000 | ၈၀ သိန်း ၆ သောင်းကျပ် |

### sendNotificationToAdmin(text)

လက်ရှိတွင် `console.log` ဖြင့် အစားထိုးထားသည်။ နောင်တွင် Telegram Bot, SMS, သို့မဟုတ် Email API ချိတ်ဆက်နိုင်ရန် နေရာချန်ထားပေးသည်။

## ထွက်ရှိလာသော Report ပုံစံ

```
ဒီတစ်လ၏ အရောင်းအစီရင်ခံစာ အနှစ်ချုပ်မှာ အောက်ပါအတိုင်း ဖြစ်ပါတယ်ခင်ဗျာ -

• စုစုပေါင်း ရောင်းအားပမာဏ: ၅၄ သိန်းကျပ်
• ကဒ်/Mobile Banking ဖြင့် ပေးချေမှု: ၃၀ သိန်းကျပ်
• လက်ငင်းငွေသား (Cash) ဖြင့် ပေးချေမှု: ၂၄ သိန်းကျပ်
• လျှော့စျေး (Discount): ၂ သိန်းကျပ်
• စုစုပေါင်း အော်ဒါ (Order) အရေအတွက်: ၈၇ ခု
• စုစုပေါင်း ရောင်းရသည့် ပစ္စည်းအရေအတွက်: ၂၃၄ ခု

ကျေးဇူးတင်ပါတယ်ခင်ဗျာ။
```

## ကုန်ကျစရိတ် သက်သာစေရန်

- **AI/OpenRouter မသုံးပါ** — စာသားပုံစံသည် နေ့စဉ်တူညီနေသောကြောင့် `formatMyanmarCurrency()` နှင့် `toMyanmarDigits()` လုပ်ဆောင်ချက်များဖြင့် တိုက်ရိုက်ဖော်ပြသည်။
- **API Cost မရှိ** — ရှိပြီးသား Service Functions များကို တိုက်ရိုက်ခေါ်ယူအသုံးပြုသည်။
- **Memory Usage နည်းသည်** — 512MB RAM အတွက် အကောင်းဆုံးဖြစ်အောင် ရေးသားထားသည်။

## နောင်တွင် ပြင်ဆင်နိုင်သော အချက်များ

### Cron Time ပြောင်းလဲရန်

`dailyReportCron.service.js` ရှိ အောက်ပါ စာကြောင်းကို ပြောင်းလဲပါ:

```javascript
cron.schedule("0 21 * * *", ...)  // 21 = ညနေ ၉ နာရီ
```

Cron Format: `တစ်မိနစ် တစ်နာရီ တစ်ရက် တစ်လ တစ်ပတ်ရက်`

| အချိန် | Cron Expression |
|--------|----------------|
| ညနေ ၉ နာရီ | `0 21 * * *` |
| ညနေ ၆ နာရီ | `0 18 * * *` |
| မနက် ၈ နာရီ | `0 8 * * *` |
| ညနေ ၉ နာရီ ၃၀ မိနစ် | `30 21 * * *` |

### Telegram Bot ချိတ်ဆက်ရန်

`sendNotificationToAdmin()` function အတွင်းတွင် အောက်ပါအတိုင်း ထည့်သွင်းနိုင်သည်:

```javascript
async function sendNotificationToAdmin(text) {
  // Telegram Bot API
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text }),
  });
}
```

### SMS API ချိတ်ဆက်ရန်

```javascript
async function sendNotificationToAdmin(text) {
  // SMS Gateway API
  await fetch("https://api.sms-gateway.com/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: "09xxxxxxxxx", message: text }),
  });
}
```

## Log Messages

| Message | အဓိပ္ပာယ် |
|---------|-----------|
| `[DailyReportCron] Scheduled for 9:00 PM daily.` | Cron Job စတင်ပြီး စောင့်ဆိုင်းနေသည် |
| `[DailyReportCron] Running daily report at 9:00 PM...` | Report စတင်ထုတ်လုပ်နေသည် |
| `[DailyReportCron] Report completed successfully.` | Report အောင်မြင်စွာ ပြီးဆုံးသည် |
| `[DailyReportCron] Error: ...` | Report ထုတ်ရာတွင် အမှားအယွင်းရှိနေသည် |

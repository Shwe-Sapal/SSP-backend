# Lucky Draw Feature - Edge Cases & Improvements Analysis

ဤအစီရင်ခံစာသည် SSP-backend ရှိ Lucky Draw Promotion နှင့် Redemption feature များတွင် တွေ့ရှိရသည့် ဖြစ်ပွားနိုင်ခြေရှိသော ပြဿနာများ (Edge Cases) နှင့် ၎င်းတို့ကို ပြင်ဆင်ရန် အကြံပြုချက်များကို အသေးစိတ် ဖော်ပြထားပါသည်။

---

## ၁။ Storefront မကိုက်ညီမှု (Storefront Mismatch)

> [!WARNING]
> **လက်ရှိ ပြဿနာ:** Promotion ဖန်တီးစဉ်က သတ်မှတ်ခဲ့သော `storefrontId` နှင့် Redemption ပြုလုပ်သည့် ဆိုင်ခွဲ `storefrontId` ကို တိုက်ဆိုင်စစ်ဆေးခြင်း မရှိပါ။

* **သက်ရောက်မှု:** ဥပမာ - ရန်ကုန်ဆိုင်ခွဲအတွက်သာ သီးသန့်ပြုလုပ်ထားသော Promotion လက်မှတ်အား မန္တလေးဆိုင်ခွဲတွင် လာရောက်လဲလှယ်သော်လည်း စနစ်က ခွင့်ပြုပေးနေမည် ဖြစ်သည်။
* **အဆိုပြုပြင်ဆင်ချက်:** [luckyDraw.controller.js](file:///c:/Users/PC/Desktop/SSP_Project/SSP-backend/src/controllers/luckyDraw.controller.js#L153) ရှိ `processRedemption` function တွင် Promotion ၏ `storefrontId` ပါရှိပါက လက်ရှိလဲလှယ်မည့် `storefrontId` နှင့် တူညီမှု ရှိမရှိကို အောက်ပါအတိုင်း စစ်ဆေးရန် -
  ```javascript
  if (promotion.storefrontId && promotion.storefrontId.toString() !== storefrontId.toString()) {
    throw new CustomError(400, "This promotion is not valid for this storefront branch");
  }
  ```

---

## ၂။ ပမာဏ မမှန်ကန်မှုများ (Negative/Decimal Quantity Input)

> [!IMPORTANT]
> **လက်ရှိ ပြဿနာ:** Redemption တောင်းဆိုရာတွင် ပါဝင်သည့် လဲလှယ်မည့်အရေအတွက် `quantity` ကို ပုံစံမှန်ကန်မှု ရှိမရှိ စစ်ဆေးထားခြင်း မရှိပါ။

* **သက်ရောက်မှု:** 
  * အကယ်၍ User သို့မဟုတ် API Client က `quantity: -5` (အနုတ် ၅) ဟု ပို့လိုက်ပါက စနစ်၏ Stock တွက်ချက်မှု `quantity: -productQuantity` (အနုတ်နှင့် အနုတ်မြှောက်သဖြင့် အပေါင်းဖြစ်သွားခြင်း) ကြောင့် **ကုန်ပစ္စည်း Stock တွက်ချက်မှုများ မှားယွင်းပြီး Stock များ ပိုတိုးလာပါလိမ့်မည်**။
  * `quantity: 1.5` ကဲ့သို့ ဒဿမကိန်းများ ပေးပို့လာပါကလည်း စနစ်တွင် ဒဿမကိန်းဖြင့် Stock စာရင်းများ ဖြစ်ပေါ်စေနိုင်သည်။
* **အဆိုပြုပြင်ဆင်ချက်:** `quantity` သည် `1` သို့မဟုတ် ထို့ထက်ကြီးသော ကိန်းပြည့် (Positive Integer) ဖြစ်ရမည်ဟု စစ်ဆေးရန် -
  ```javascript
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity <= 0)) {
    return next(new CustomError(400, "Quantity must be a positive integer"));
  }
  ```

---

## ၃။ အသုံးပြုပြီးသား လက်မှတ်ကုဒ်များ (Duplicate Ticket Code)

> [!NOTE]
> **လက်ရှိ ပြဿနာ:** `ticketCode` သည် Database တွင် Unique index မရှိသလို၊ အသုံးပြုပြီးသား ဟုတ်မဟုတ်ကိုလည်း API က စစ်ဆေးပေးခြင်း မရှိပါ။

* **သက်ရောက်မှု:** ဖောက်သည်တစ်ဦးသည် အသုံးပြုပြီးသား ကံစမ်းမဲလက်မှတ် ကုဒ်နံပါတ်ဟောင်းတစ်ခုတည်းကိုပင် အသုံးပြု၍ ကုန်ပစ္စည်းများကို ထပ်ခါတလဲလဲ လာရောက်ထုတ်ယူသွားနိုင်ပါသည်။
* **အဆိုပြုပြင်ဆင်ချက်:** လုပ်ငန်းသဘောတရားအရ လက်မှတ်တစ်စောင်ကို တစ်ကြိမ်သာ လဲလှယ်ခွင့်ပြုမည်ဆိုပါက [luckyDraw.controller.js](file:///c:/Users/PC/Desktop/SSP_Project/SSP-backend/src/controllers/luckyDraw.controller.js) တွင် အောက်ပါအတိုင်း စစ်ဆေးရန် -
  ```javascript
  if (ticketCode) {
    const existingTicket = await LuckyDrawRedemption.findOne({ ticketCode, isDeleted: false }).session(session);
    if (existingTicket) {
      throw new CustomError(400, "This ticket code has already been redeemed");
    }
  }
  ```

---

## ၄။ စျေးနှုန်းတွက်ချက်မှုဆိုင်ရာ မူဝါဒ (Pricing Logic)

> [!TIP]
> **စီးပွားရေးလုပ်ငန်းဆိုင်ရာ စစ်ဆေးချက်:** လက်ရှိ စုစုပေါင်းတန်ဖိုး တွက်ချက်ပုံမှာ အောက်ပါအတိုင်း ဖြစ်ပါသည် -
  `totalAmount = promotion.redemptionPrice * productQuantity`

* **သက်ရောက်မှု:** 
  * အကယ်၍ `quantityPerRedeem = 5` (လက်မှတ် ၁ စောင်လဲလျှင် ကုန်ပစ္စည်း ၅ ခုရမည်) ဟု သတ်မှတ်ထားပြီး၊ လက်မှတ်၏ တန်ဖိုးမှာ `500` ဖြစ်ပါက စနစ်က `500 * 5 = 2500` ဟု တွက်ချက်သွားပါလိမ့်မည်။
  * `redemptionPrice` (500) သည် **ကုန်ပစ္စည်း တစ်ခုချင်းစီ၏ နှုန်းထား** ဖြစ်ပါက ဤတွက်ချက်မှုမှာ မှန်ကန်သော်လည်း၊ ၎င်းသည် **လက်မှတ်တစ်စောင်လုံး၏ တန်ဖိုး** သာ ဖြစ်ပါက တွက်ချက်မှု မှားယွင်းနေပါသည်။
* **အဆိုပြုပြင်ဆင်ချက်:** လုပ်ငန်း၏ စည်းမျဉ်းသတ်မှတ်ချက်အပေါ် မူတည်၍ စျေးနှုန်းတွက်ချက်မှုကို ပြန်လည်စိစစ်ရန် လိုအပ်ပါသည်။

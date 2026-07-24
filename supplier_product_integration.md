# Plan: Supplier Township & Product Integration

**Date:** 2026-07-24  
**Status:** Draft / Ready for Implementation  

## Objective
1. Supplier များ၏ လိပ်စာ (Address) တွင် Township (မြို့နယ်) ကို အသစ်ထပ်မံ ထည့်သွင်းနိုင်ရန်။
2. Product များနှင့် Supplier များကို ချိတ်ဆက်ပေးရန် (ကုန်ပစ္စည်း Stock များကို မည်သည့် Supplier ထံမှ ဝယ်ယူရရှိနိုင်ကြောင်း အလွယ်တကူ ခြေရာခံနိုင်ရန်)။

## Files to Modify
* `src/models/supplier.model.js` — Address Schema တွင် `township` Field အသစ်ထည့်ရန်
* `src/models/product.model.js` — Supplier ID များကို ချိတ်ဆက်မည့် `suppliers` Array ထည့်ရန်
* `src/controllers/supplier.controller.js` — Township Data အား Create/Update လုပ်နိုင်ရန် ပြင်ဆင်ရန်
* `src/controllers/product.controller.js` — Product Fetch လုပ်သည့်အခါ Supplier အချက်အလက်များ ပါဝင်လာစေရန် Populate လုပ်ရန်
* `src/validations/supplier.validation.js` — Input Validation တွင် `township` အတွက် စစ်ဆေးမှု ထည့်ရန်

## Implementation Steps

### 1. Supplier Schema Update
`supplier.model.js` ရှိ `address` အပိုင်းတွင် `township` ကို String အနေဖြင့် ထည့်သွင်းပါမည်။
```javascript
address: {
  street: { type: String, trim: true },
  township: { type: String, trim: true }, // New Field
  city: { type: String, trim: true },
  state: { type: String, trim: true }
}

### 2. Product Schema Update
product.model.js တွင် Product တစ်ခုကို Supplier တစ်ဦး (သို့) တစ်ဦးထက်မကထံမှ ဝယ်ယူနိုင်ရန် suppliers ကို Array of ObjectIds ဖြင့် ထည့်သွင်းပါမည်
suppliers: [{
  type: mongoose.Schema.Types.ObjectId,
  ref: "Supplier"
}]

### 3. Controller & Query Logic
product.controller.js တွင် Product (သို့) Stock များကို ဆွဲယူသည့် API ၌ Supplier Detail များကိုပါ တစ်ပါတည်း ရရှိရန် populate ကို အသုံးပြုပါမည်။
const products = await Product.find({ isDeleted: false })
  .populate({
    path: "suppliers",
    match: { isDeleted: false },
    select: "name phone email address"
  })
  .exec();

Edge Cases & Considerations
Data Migration: ယခင်ရှိပြီးသား Supplier အဟောင်းများတွင် township Data ရှိမည်မဟုတ်သဖြင့် Model တွင် required: true မထားဘဲ Optional အဖြစ်သာ ထားရှိမည်။

Multiple Suppliers: ပစ္စည်းတစ်ခုတည်းကို Supplier အများကြီးဆီက ဝယ်လို့ရနိုင်တဲ့အတွက် Product Schema မှာ suppliers ကို Array အဖြစ် သတ်မှတ်ထားခြင်း ဖြစ်သည်။

Deleted Suppliers: Supplier ကို Soft Delete လုပ်လိုက်ပါက Product ၏ Response တွင် Deleted Supplier များ မပါဝင်လာစေရန် Populate Query တွင် Match Condition (isDeleted: false) ထည့်သွင်းထားသည်။

Test Plan
Postman မှတစ်ဆင့် Supplier အသစ် Create / Update လုပ်ရာတွင် township Data အောင်မြင်စွာ ဝင်ရောက်မှု ရှိ/မရှိ Database တွင် စမ်းသပ်မည်။

Product အသစ် ဖန်တီးရာတွင် (သို့) Update လုပ်ရာတွင် suppliers Array အတွင်း Supplier ID များ ထည့်သွင်းစမ်းသပ်မည်။

GET /api/v1/products ကို ခေါ်ယူပြီး Product နှင့်အတူ ချိတ်ဆက်ထားသော Supplier ၏ Township ပါဝင်သည့် အချက်အလက်များ အမှန်တကယ် ထွက်ပေါ်လာခြင်း ရှိ/မရှိ စစ်ဆေးမည်။
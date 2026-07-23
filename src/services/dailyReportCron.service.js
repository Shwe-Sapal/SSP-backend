import cron from "node-cron";
import * as aiSaleReport from "./aiSaleReport.service.js";
import ShopSetting from "../models/shopSetting.model.js";
import DailyReport from "../models/dailyReport.model.js";

let cronTask = null;

function toMyanmarDigits(num) {
  const digits = "၀၁၂၃၄၅၆၇၈၉";
  return String(num).replace(/\d/g, (d) => digits[parseInt(d)]);
}

function formatMyanmarCurrency(amount) {
  const num = Math.round(amount);
  return `${num.toLocaleString("en-US")} ကျပ်`;
}

function sendNotificationToAdmin(text) {
  console.log("=== Daily Report Notification ===");
  console.log(text);
  console.log("=== End ===");
}

async function generateDailyReport() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const startDate = `${year}-${month}-01`;
  const endDate = `${year}-${month}-${day}`;
  const dateKey = `${year}-${month}-${day}`;

  const [summary, paymentMethods, products] = await Promise.all([
    aiSaleReport.getSaleReportSummary(undefined, startDate, endDate),
    aiSaleReport.getPaymentMethodReport(undefined, startDate, endDate),
    aiSaleReport.getProductSalesReport(undefined, startDate, endDate),
  ]);

  const report = summary.report;

  const totalCardAmount = paymentMethods.paymentMethods
    .filter((pm) => pm.paymentMethod === "kpay" || pm.paymentMethod === "bank")
    .reduce((sum, pm) => sum + pm.totalPaidAmount, 0);

  const totalCashAmount = paymentMethods.paymentMethods
    .filter((pm) => pm.paymentMethod === "cash")
    .reduce((sum, pm) => sum + pm.totalPaidAmount, 0);

  const totalQuantity = products.totals?.totalQuantity || 0;

  const message = [
    `ဒီတစ်လ၏ အရောင်းအစီရင်ခံစာ အနှစ်ချုပ်မှာ အောက်ပါအတိုင်း ဖြစ်ပါတယ်ခင်ဗျာ -\n`,
    `• စုစုပေါင်း ရောင်းအားပမာဏ: ${formatMyanmarCurrency(report.finalAmount)}`,
    `• ကဒ်/Mobile Banking ဖြင့် ပေးချေမှု: ${formatMyanmarCurrency(totalCardAmount)}`,
    `• လက်ငင်းငွေသား (Cash) ဖြင့် ပေးချေမှု: ${formatMyanmarCurrency(totalCashAmount)}`,
    `• လျှော့စျေး (Discount): ${formatMyanmarCurrency(report.discount)}`,
    `• စုစုပေါင်း အော်ဒါ (Order) အရေအတွက်: ${toMyanmarDigits(report.orderCount)} ခု`,
    `• စုစုပေါင်း ရောင်းရသည့် ပစ္စည်းအရေအတွက်: ${toMyanmarDigits(totalQuantity)} ခု\n`,
    `ကျေးဇူးတင်ပါတယ်ခင်ဗျာ။`,
  ].join("\n");

  // Save to database
  try {
    await DailyReport.findOneAndUpdate(
      { date: dateKey },
      {
        date: dateKey,
        period: "daily",
        finalAmount: report.finalAmount || 0,
        paidAmount: report.paidAmount || 0,
        discount: report.discount || 0,
        totalCardAmount: totalCardAmount || 0,
        totalCashAmount: totalCashAmount || 0,
        orderCount: report.orderCount || 0,
        creditOrderCount: report.creditOrderCount || 0,
        paidOrderCount: report.paidOrderCount || 0,
        totalQuantity: totalQuantity || 0,
        reportText: message,
        generatedAt: new Date(),
      },
      { upsert: true, new: true },
    );
    console.log("[DailyReportCron] Report saved to database.");
  } catch (dbError) {
    console.error("[DailyReportCron] Failed to save report to DB:", dbError.message);
  }

  sendNotificationToAdmin(message);
}

async function getCronExpression() {
  try {
    const settings = await ShopSetting.getCurrentSettings();
    if (!settings || settings.dailyReportEnabled === false) {
      console.log("[DailyReportCron] Daily reports are disabled.");
      return null;
    }
    const time = settings.dailyReportTime || "21:00";
    const [hour, minute] = time.split(":");
    return `${parseInt(minute)} ${parseInt(hour)} * * *`;
  } catch (error) {
    console.error("[DailyReportCron] Error reading settings, using default 21:00:", error.message);
    return "0 21 * * *";
  }
}

export async function startDailyReportCron() {
  const cronExpr = await getCronExpression();
  if (!cronExpr) {
    console.log("[DailyReportCron] Cron not started — daily reports are disabled.");
    return;
  }

  if (cronTask) {
    cronTask.stop();
  }

  cronTask = cron.schedule(cronExpr, async () => {
    console.log(`[DailyReportCron] Running daily report (schedule: ${cronExpr})...`);
    try {
      await generateDailyReport();
      console.log("[DailyReportCron] Report completed successfully.");
    } catch (err) {
      console.error("[DailyReportCron] Error:", err.message);
    }
  });

  console.log(`[DailyReportCron] Scheduled: ${cronExpr}`);
}

export async function rescheduleCron() {
  if (cronTask) {
    cronTask.stop();
    console.log("[DailyReportCron] Previous cron stopped.");
  }
  await startDailyReportCron();
}

import mongoose from "mongoose";
import Order from "../models/orders.model.js";
import CreditRecord from "../models/creditRecord.model.js";
import CreditPerson from "../models/creditPersona.model.js";
import LocationProfile from "../models/locationProfile.model.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";

function buildDateFilter(startDate, endDate) {
  if (!startDate && !endDate) return {};
  return createDateFilter({ startDate, endDate }, "createdAt", false);
}

export function formatMyanmarCurrency(value) {
  if (value === undefined || value === null) return "0 ကျပ်";
  const num = Math.round(value);
  return `${num.toLocaleString("en-US")} ကျပ်`;
}

async function getStorefrontIfValid(storefrontId) {
  if (!storefrontId) return null;
  if (!mongoose.Types.ObjectId.isValid(storefrontId)) {
    throw new Error("Invalid storefront ID format");
  }
  return LocationProfile.findOne({
    _id: storefrontId,
    type: "storefront",
    isDeleted: false,
  });
}

function buildBaseFilter(storefrontId, startDate, endDate) {
  const filter = { isDeleted: false, orderStatus: "completed" };
  if (storefrontId) {
    if (!mongoose.Types.ObjectId.isValid(storefrontId)) {
      throw new Error("Invalid storefront ID format");
    }
    filter.storefrontId = new mongoose.Types.ObjectId(storefrontId);
  }
  const dateFilter = buildDateFilter(startDate, endDate);
  if (dateFilter.createdAt) {
    Object.assign(filter, dateFilter);
  }
  return filter;
}

export async function getSaleReportSummary(storefrontId, startDate, endDate) {
  const filter = buildBaseFilter(storefrontId, startDate, endDate);
  const storefront = await getStorefrontIfValid(storefrontId);

  const saleReport = await Order.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        totalFinalAmount: { $sum: "$finalAmount" },
        totalPaidAmount: { $sum: "$paidAmount" },
        totalDiscount: { $sum: "$discount" },
        totalExtraChange: { $sum: "$extraChange" },
        orderCount: { $sum: 1 },
        creditOrderCount: {
          $sum: { $cond: [{ $eq: ["$paymentType", "credit"] }, 1, 0] },
        },
        paidOrderCount: {
          $sum: { $cond: [{ $eq: ["$paymentType", "paid"] }, 1, 0] },
        },
        totalCreditAmount: {
          $sum: { $cond: [{ $eq: ["$paymentType", "credit"] }, "$finalAmount", 0] },
        },
      },
    },
  ]);

  const report = saleReport[0] || {
    totalFinalAmount: 0, totalPaidAmount: 0,
    totalDiscount: 0, totalExtraChange: 0,
    orderCount: 0, creditOrderCount: 0, paidOrderCount: 0,
    totalCreditAmount: 0,
  };

  return {
    storefront: storefront ? { locationName: storefront.locationName } : null,
    report: {
      finalAmount: report.totalFinalAmount,
      finalAmountFormatted: formatMyanmarCurrency(report.totalFinalAmount),
      paidAmount: report.totalPaidAmount,
      paidAmountFormatted: formatMyanmarCurrency(report.totalPaidAmount),
      discount: report.totalDiscount,
      discountFormatted: formatMyanmarCurrency(report.totalDiscount),
      extraChange: report.totalExtraChange,
      extraChangeFormatted: formatMyanmarCurrency(report.totalExtraChange),
      orderCount: report.orderCount,
      creditOrderCount: report.creditOrderCount,
      paidOrderCount: report.paidOrderCount,
      creditAmount: report.totalCreditAmount,
      creditAmountFormatted: formatMyanmarCurrency(report.totalCreditAmount),
    },
  };
}

export async function getPaymentMethodReport(storefrontId, startDate, endDate) {
  const filter = buildBaseFilter(storefrontId, startDate, endDate);
  const paidFilter = { ...filter, paymentType: "paid" };

  const paymentMethodReport = await Order.aggregate([
    { $match: paidFilter },
    {
      $group: {
        _id: "$paymentMethod",
        totalPaidAmount: { $sum: "$paidAmount" },
      },
    },
    { $sort: { totalPaidAmount: -1 } },
  ]);

  return {
    paymentMethods: paymentMethodReport.map((item) => ({
      paymentMethod: item._id || "unknown",
      totalPaidAmount: item.totalPaidAmount,
      totalPaidAmountFormatted: formatMyanmarCurrency(item.totalPaidAmount),
    })),
  };
}

export async function getCreditSaleReport(storefrontId, startDate, endDate) {
  const filter = buildBaseFilter(storefrontId, startDate, endDate);
  const creditFilter = { ...filter, paymentType: "credit" };

  const creditOrders = await Order.find(creditFilter).select(
    "_id finalAmount paidAmount"
  ).lean();

  const orderIds = creditOrders.map((order) => order._id);

  const creditRecords = await CreditRecord.find({
    orderId: { $in: orderIds },
    isDeleted: false,
  }).select("orderId paidAmount").lean();

  const totalFinalAmount = creditOrders.reduce((sum, o) => sum + (o.finalAmount || 0), 0);
  const totalPaidAmount = creditOrders.reduce((sum, o) => sum + (o.paidAmount || 0), 0);
  const totalRemainingBalance = totalFinalAmount - totalPaidAmount;

  return {
    totals: {
      totalFinalAmount,
      totalFinalAmountFormatted: formatMyanmarCurrency(totalFinalAmount),
      totalPaidAmount,
      totalPaidAmountFormatted: formatMyanmarCurrency(totalPaidAmount),
      totalRemainingBalance: Math.max(0, totalRemainingBalance),
      totalRemainingBalanceFormatted: formatMyanmarCurrency(Math.max(0, totalRemainingBalance)),
      orderCount: creditOrders.length,
      creditRecordCount: creditRecords.length,
    },
  };
}

export async function getProductSalesReport(storefrontId, startDate, endDate) {
  const filter = buildBaseFilter(storefrontId, startDate, endDate);

  const productSalesReport = await Order.aggregate([
    { $match: filter },
    { $unwind: "$ordersProducts" },
    {
      $lookup: {
        from: "inventories",
        localField: "ordersProducts.inventoryId",
        foreignField: "_id",
        as: "invLookup",
      },
    },
    { $unwind: { path: "$invLookup", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$ordersProducts.inventoryId",
        totalQuantity: { $sum: "$ordersProducts.quantity" },
        totalRevenue: { $sum: { $multiply: ["$ordersProducts.quantity", "$ordersProducts.unitPrice"] } },
        totalBuyingPrice: {
          $sum: {
            $multiply: [
              "$ordersProducts.quantity",
              { $ifNull: ["$ordersProducts.buyingPrice", "$invLookup.buyingPrice"] },
            ],
          },
        },
        productName: { $first: "$invLookup.productName" },
      },
    },
    {
      $addFields: {
        totalProfit: { $subtract: ["$totalRevenue", "$totalBuyingPrice"] },
      },
    },
    { $sort: { totalQuantity: -1 } },
    { $limit: 5 },
    {
      $project: {
        _id: 0,
        productName: 1,
        totalQuantity: 1,
        totalRevenue: 1,
        totalProfit: 1,
      },
    },
  ]);

  const totals = productSalesReport.reduce(
    (acc, item) => {
      acc.totalQuantity += item.totalQuantity;
      acc.totalRevenue += item.totalRevenue;
      acc.totalProfit += item.totalProfit;
      acc.totalUniqueProducts += 1;
      return acc;
    },
    { totalQuantity: 0, totalRevenue: 0, totalProfit: 0, totalUniqueProducts: 0 }
  );

  return {
    totals: {
      ...totals,
      totalRevenueFormatted: formatMyanmarCurrency(totals.totalRevenue),
      totalProfitFormatted: formatMyanmarCurrency(totals.totalProfit),
    },
    topProducts: productSalesReport.map((item) => ({
      ...item,
      totalRevenueFormatted: formatMyanmarCurrency(item.totalRevenue),
      totalProfitFormatted: formatMyanmarCurrency(item.totalProfit),
    })),
  };
}

export async function getCreditPersonaProductReport(creditPersonaId, storefrontId, startDate, endDate) {
  if (!creditPersonaId) throw new Error("creditPersonaId is required");
  if (!mongoose.Types.ObjectId.isValid(creditPersonaId)) {
    throw new Error("Invalid credit persona ID format");
  }

  const creditPersona = await CreditPerson.findOne({ _id: creditPersonaId });
  if (!creditPersona) throw new Error("Credit persona not found");

  const filter = buildBaseFilter(storefrontId, startDate, endDate);
  const personaFilter = {
    ...filter,
    paymentType: "credit",
    creditPersonId: new mongoose.Types.ObjectId(creditPersonaId),
  };

  const productReport = await Order.aggregate([
    { $match: personaFilter },
    { $unwind: "$ordersProducts" },
    {
      $group: {
        _id: "$ordersProducts.inventoryId",
        totalQuantity: { $sum: "$ordersProducts.quantity" },
        productName: { $first: "$ordersProducts.productName" },
      },
    },
    { $sort: { totalQuantity: -1 } },
    { $limit: 5 },
    {
      $project: {
        _id: 0,
        productName: 1,
        totalQuantity: 1,
      },
    },
  ]);

  const totals = productReport.reduce(
    (acc, item) => {
      acc.totalQuantity += item.totalQuantity;
      acc.totalUniqueProducts += 1;
      return acc;
    },
    { totalQuantity: 0, totalUniqueProducts: 0 }
  );

  return {
    creditPersona: { name: creditPersona.name },
    totals,
    topProducts: productReport,
  };
}

export async function getSaleProductsAnalyticsByCreditPerson(storefrontId, inventoryId, startDate, endDate) {
  const filter = buildBaseFilter(storefrontId, startDate, endDate);
  const analyticsFilter = {
    ...filter,
    paymentType: "credit",
    creditPersonId: { $exists: true, $ne: null },
  };

  if (inventoryId) {
    if (!mongoose.Types.ObjectId.isValid(inventoryId)) {
      throw new Error("Invalid inventory ID format");
    }
    analyticsFilter["ordersProducts.inventoryId"] = new mongoose.Types.ObjectId(inventoryId);
  }

  const productAnalytics = await Order.aggregate([
    { $match: analyticsFilter },
    { $unwind: "$ordersProducts" },
    {
      $group: {
        _id: { inventoryId: "$ordersProducts.inventoryId", creditPersonId: "$creditPersonId" },
        totalQuantity: { $sum: "$ordersProducts.quantity" },
        productName: { $first: "$ordersProducts.productName" },
      },
    },
    {
      $group: {
        _id: "$_id.inventoryId",
        totalQuantity: { $sum: "$totalQuantity" },
        uniqueCreditPersons: { $addToSet: "$_id.creditPersonId" },
        productName: { $first: "$productName" },
      },
    },
    { $addFields: { uniqueCreditPersonsCount: { $size: "$uniqueCreditPersons" } } },
    { $sort: { totalQuantity: -1 } },
    { $limit: 5 },
    {
      $project: {
        _id: 0,
        productName: 1,
        totalQuantity: 1,
        uniqueCreditPersonsCount: 1,
      },
    },
  ]);

  const totals = productAnalytics.reduce(
    (acc, item) => {
      acc.totalQuantity += item.totalQuantity;
      acc.totalUniqueProducts += 1;
      return acc;
    },
    { totalQuantity: 0, totalUniqueProducts: 0 }
  );

  return { totals, topProducts: productAnalytics };
}

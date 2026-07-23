import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import * as aiSaleReport from "../services/aiSaleReport.service.js";

export const getSummary = asyncErrorHandler(async (req, res) => {
  const { storefrontId, startDate, endDate } = req.query;
  const data = await aiSaleReport.getSaleReportSummary(storefrontId, startDate, endDate);
  res.status(200).json({ success: true, data });
});

export const getPaymentMethods = asyncErrorHandler(async (req, res) => {
  const { storefrontId, startDate, endDate } = req.query;
  const data = await aiSaleReport.getPaymentMethodReport(storefrontId, startDate, endDate);
  res.status(200).json({ success: true, data });
});

export const getCreditSales = asyncErrorHandler(async (req, res) => {
  const { storefrontId, startDate, endDate } = req.query;
  const data = await aiSaleReport.getCreditSaleReport(storefrontId, startDate, endDate);
  res.status(200).json({ success: true, data });
});

export const getTopProducts = asyncErrorHandler(async (req, res) => {
  const { storefrontId, startDate, endDate } = req.query;
  const data = await aiSaleReport.getProductSalesReport(storefrontId, startDate, endDate);
  res.status(200).json({ success: true, data });
});

export const getCreditPersonaProducts = asyncErrorHandler(async (req, res) => {
  const { creditPersonaId, storefrontId, startDate, endDate } = req.query;
  const data = await aiSaleReport.getCreditPersonaProductReport(
    creditPersonaId, storefrontId, startDate, endDate
  );
  res.status(200).json({ success: true, data });
});

export const getProductsByCreditPerson = asyncErrorHandler(async (req, res) => {
  const { storefrontId, inventoryId, startDate, endDate } = req.query;
  const data = await aiSaleReport.getSaleProductsAnalyticsByCreditPerson(
    storefrontId, inventoryId, startDate, endDate
  );
  res.status(200).json({ success: true, data });
});

import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import DailyReport from "../models/dailyReport.model.js";

// Get paginated daily reports
export const getDailyReports = asyncErrorHandler(async (req, res, next) => {
  const { page = 1, limit = 15 } = req.query;

  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 15;
  const skip = (pageNum - 1) * limitNum;

  const [reports, total] = await Promise.all([
    DailyReport.find({})
      .sort({ date: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    DailyReport.countDocuments({}),
  ]);

  const totalPages = Math.ceil(total / limitNum);

  res.status(200).json({
    success: true,
    message: "Daily reports fetched successfully",
    data: reports,
    pagination: {
      currentPage: pageNum,
      totalPages,
      totalItems: total,
      itemsPerPage: limitNum,
    },
  });
});

// Get the latest daily report
export const getLatestDailyReport = asyncErrorHandler(async (req, res, next) => {
  const report = await DailyReport.findOne({})
    .sort({ date: -1 })
    .lean();

  res.status(200).json({
    success: true,
    message: report ? "Latest report fetched successfully" : "No reports found yet",
    data: report,
  });
});

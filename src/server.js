import Db from "./configs/db.config.js";
import process from "node:process";
import app from "./app.js";
import { startDailyReportCron } from "./services/dailyReportCron.service.js";
process.on("uncaughtException", (err) => {
  console.log("Inside uncaughtException handler");
  console.log(err.name, err.message);
  console.log("Uncaught Expection occured. Server is Shutting down!!!");
  process.exit(1);
});

Db();

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`SERVER is Running at PORT:${port}`);
  startDailyReportCron().catch((err) => {
    console.error("[DailyReportCron] Failed to start:", err.message);
  });
});

process.on("unhandledRejection", (err) => {
  console.log(err.name, err.message);
  console.log("Unhandle Rejection occured. Server is Shutting down!!!");
  process.exit(1);
});

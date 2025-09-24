// logger.js
import winston from "winston";
import fs from "fs";

// Make sure logs folder exists
const logDir = "logs";
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Create logger instance
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      (info) =>
        `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}`
    )
  ),
  transports: [
    new winston.transports.File({
      filename: `${logDir}/ocpp.log`, // single log file
      maxsize: 5 * 1024 * 1024, // 5MB per file (then rotates)
      maxFiles: 5, // keep last 5 files
    }),
  ],
});

export default logger;

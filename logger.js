import winston from "winston";
import fs from "fs";

const logDir = "logs";
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const logger = winston.createLogger({
  // 👇 Important: set lowest level you want to capture globally
  level: "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      (info) =>
        `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}`
    )
  ),
  transports: [
    // ✅ Info & other normal logs
    new winston.transports.File({
      filename: `${logDir}/ocpp.log`,
      level: "info", // includes info, warn, error
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),

    // ⚠️ Error-only logs
    new winston.transports.File({
      filename: `${logDir}/error.log`,
      level: "error", // error only
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),

    // 🖥️ Optional console output
    new winston.transports.Console({
      level: "debug",
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

export default logger;

// utils/loggerHelper.js
import logger from "../logger.js";

export function logError({
  action,
  status = "Error",
  messageId = null,
  payload = null,
  idTagInfo = null,
  reason = null,
  error = null,
  stack = null
}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    action,
    status,
    messageId,
    reason,
    payload,
    idTagInfo,
    error,
    stack
  };

  // Remove null/undefined values for cleaner logs
  Object.keys(logEntry).forEach(key => logEntry[key] == null && delete logEntry[key]);

  logger.error(logEntry);
}

// ocppHandler.js
import Ajv from "ajv";
import addFormats from "ajv-formats";
import chargePoint from "./models/chargePoint.js";

import logger from "./logger.js";
import idTag from "./models/IdTag.js";
import {
  createAndUpdateBootnotification,
  updateConnectorStatus,
} from "./services/queries.js";
import TransactionModel from "./models/transaction.js";
import StartTransactionSchema from "./jsonSchemas/StartTransaction.json" with { type: "json" };
import StopTransactionSchema from "./jsonSchemas/StopTransaction.json" with { type: "json" };
import MeterValuesSchema from "./jsonSchemas/MeterValuesSchema.json" with { type: "json" };
import { logError } from "./Utilitiy/LoggerHelper.js";
import Configuration from "./models/configuration.js";
import path from "path";
const ajv = new Ajv();
addFormats(ajv);

export class OcppHandler {
  constructor(ws, chargePointId) {
    this.ws = ws;
    this.chargePointId = chargePointId;
    this.callPromises = new Map();
  }

  // Handle incoming WebSocket messages
  onMessage(message) {
    try {
      // console.log("message", message.toString('utf8'))
      const parsedMessage = JSON.parse(message);
      // console.log("parsedMessage", parsedMessage);
      const messageType = parsedMessage[0];

      switch (messageType) {
        case 2: // Call
          this.handleCall(parsedMessage);
          break;
        case 3: // CallResult
          this.handleCallResult(parsedMessage);
          break;
        case 4: // CallError
          this.handleCallError(parsedMessage);
          break;
        default:
          console.error(`Unknown message type: ${messageType}`);
          logger.error(`Unknown message type: ${messageType}`);
          break;
      }
    } catch (error) {
      console.error("Failed to parse message:", error);
    }
  }

  // Handle a "Call" message (Charge Point initiated)
  handleCall(message) {
    const [messageType, messageId, action, payload] = message;

    switch (action) {
      case "BootNotification":
        // A Charge Point MUST again contact the Central System by sending a BootNotification request after a restart.
        this.handleBootNotification(messageId, payload, message);
        break;
      case "Authorize":
        this.handleAuthorize(messageId, payload, message);
        break;
      case "StartTransaction":
        // The Charge Point SHOULD deliver transaction-related messages to the Central System in chronological order as soon as possible.
        this.handleStartTransaction(messageId, payload, message);
        break;
      case "StopTransaction":
        this.handleStopTransaction(messageId, payload, message);
        break;
      case "Heartbeat":
        this.handleHeartbeat(messageId, message);
        break;
      case "MeterValues":
        this.handleMeterValues(messageId, payload, message);
        break;
      case "StatusNotification":
        // 3. If valid, process the message
        this.handleStatusNotification(messageId, payload, message);
        break;

      default:
        console.warn(`Unsupported action: ${action}`);
        // Send a CallError response for unsupported actions
        this.sendError(messageId, "Not Implemented Action not supported");
        logger.info(`Unsupported action: ${action}`);
        break;
    }
  }

  // Implement handlers for each OCPP action
  async handleBootNotification(messageId, payload, message) {
    console.log(`Received BootNotification from ${this.chargePointId}:`);

    const bootNotificationSchema = {
      type: "object",
      properties: {
        chargePointVendor: { type: "string", minLength: 4, maxLength: 20 },
        chargePointModel: { type: "string", minLength: 4, maxLength: 20 },
      },
      required: ["chargePointVendor", "chargePointModel"],
    };

    if (!(await this.validatePayload(bootNotificationSchema, payload))) {
      logError({
        action: message[2],
        messageId: messageId,
        payload: payload,
        reason: "FormatViolation",
      });
      // logger.error(
      //   `FormatViolation : ${message}
      //   Response : ${messageId}, ${JSON.stringify({
      //     status: "Rejected",
      //     currentTime: new Date().toISOString(),
      //     interval: 0,
      //   })}`
      // );
      // });
      return this.sendError(messageId, {
        status: "Rejected",
        currentTime: new Date().toISOString(),
        interval: 0,
      });
    }

    await createAndUpdateBootnotification(payload, this, messageId, message);

    const responsePayload = {
      status: "Accepted",
      currentTime: new Date().toISOString(),
      heartbeatInterval: 300, // seconds
    };
    return this.sendResult(messageId, responsePayload);
  }

  async validatePayload(ActionSchema, payload) {
    const validate = ajv.compile(ActionSchema);
    // console.debug("validate", validate)
    return validate(payload);
  }

  async handleAuthorize(messageId, payload, message) {
    console.log(`Received Authorize from ${this.chargePointId}:`, payload);

    const authorizeSchema = {
      type: "object",
      properties: {
        idTag: { type: "string", minLength: 4, maxLength: 20 },
      },
      required: ["idTag"],
    };

    if (!(await this.validatePayload(authorizeSchema, payload))) {
      console.warn("*** ❌ Bad request****");
      logError({
        action: message[2],
        messageId: messageId,
        payload: payload,
        reason: "FormatViolation",
      });
      return this.sendError(messageId, "FormatViolation", "Invalid payload");
    }
    try {
      const IDTAG = await idTag.findOne({ idTag: payload.idTag });
      // console.log(IDTAG)
      let idtaginfo;
      const now = new Date();
      if (!IDTAG) {
        idtaginfo = { status: "Invalid" };
      } else if (IDTAG.expiryDate && IDTAG.expiryDate < now) {
        idtaginfo = {
          status: "Expired",
          expiryDate: IDTAG.expiryDate,
          parentTag: IDTAG.parentTag,
        };
      } else {
        idtaginfo = {
          status: "Accepted",
          expiryDate: IDTAG.expiryDate,
          parentTag: IDTAG.parentTag,
        };
      }

      // Log only if status is Invalid or Rejected
      if (idtaginfo.status !== "Accepted") {
        logError({
          action: message[2],
          messageId,
          payload,
          idtaginfo: idTag,
          reason: "IdTag is exired or invalid",
        });
        return this.sendError(messageId, idtaginfo);
      }

      console.log(`Authorize result for ${payload.idTag}: ${idtaginfo.status}`);
      return this.sendResult(messageId, { idtaginfo });
    } catch (err) {
      logError({
        action: message[2],
        messageId: messageId,
        payload: payload,
        reason: "Error validating authorize request for idTag",
      });

      console.error(
        `Error validating authorize request for idTag=${payload.idTag}`,
        err
      );
      return this.sendError(messageId, { idTagInfo: { status: "Error" } });
    }
  }

  async handleHeartbeat(messageId, message) {
    const now = new Date();
    console.log(
      `[${new Date().toISOString()}] Heartbeat received from ${this.chargePointId}`
    );

    try {
      await chargePoint.findOneAndUpdate(
        { serialNumber: this.chargePointId },
        {
          $set: { lastboot: now },
          $setOnInsert: { serialNumber: this.chargePointId },
        },
        { upsert: true, runValidators: true }
      );

      return this.sendResult(messageId, { currentTime: now.toISOString() });
    } catch (err) {
      console.error(`Error updating heartbeat for ${this.chargePointId}`, err);
      logError({
        action: message[2],
        messageId: messageId,
        payload: payload,
        reason: "Error validating authorize request for idTag",
        stack: err.stack,
      });
      return this.sendError(
        messageId,
        "GenericError",
        "Internal error while processing Heartbeat."
      );
    }
  }

  async handleStartTransaction(messageId, payload, message) {
    console.log(
      `Received StartTransaction from ${this.chargePointId}:`,
      payload
    );

    if (!(await this.validatePayload(StartTransactionSchema, payload))) {
      console.warn(`Validation failed for CP ${this.chargePointId}:`);
      logError({
        action: message[2],
        messageId: messageId,
        payload: payload,
        reason: "FormatViolation",
      });

      return this.sendError(messageId, "FormatViolation", `Invalid payload`);
    }

    // //***** */ Connector Availability Check
    // const chargePointDoc = await chargePoint.findOne({ serialNumber: this.chargePointId });
    // const connector = chargePointDoc.connectors.find(c => c.connectorId === connectorId);

    // if (!connector || connector.status !== 'Preparing') {
    //   // If the status is already Charging, Suspended, or Available (not plugged in)
    //   console.warn(`Connector ${connectorId} on CP ${this.chargePointId} is not in 'Preparing' state.`);
    //   return this.sendResult(messageId, {
    //     idTagInfo: { status: 'Rejected' },
    //     transactionId: 0
    //   });
    // }

    //*****  2. ID Tag Status Check */

    // --- 2. Extract Data from Payload ---
    const { connectorId, idTag, meterStart, timestamp } = payload;

    // --- 3. Validate Transaction Prerequisites (Optional but recommended) ---
    // (e.g., check if the CP's connector is actually in 'Preparing' status)
    const txnId = Math.floor(Math.random() * 1000);
    try {
      // --- 4. Database Operation: CREATE Transaction ---
      const newTransaction = await TransactionModel.create({
        chargePoint: this.chargePointId, // Reference to the CP document's ObjectId
        connectorId: connectorId,
        csTransactionId: txnId, // mock for now
        idTag,
        start_timestamp: new Date(timestamp),
        meterStart: meterStart,
        isFinished: false, // Mark as active
      });

      // console.debug("newTransaction", newTransaction)

      // --- 5. Database Operation: UPDATE Charge Point Connector Status ---
      // We update your existing CP schema to reflect the active session
      await chargePoint.updateOne(
        {
          serialNumber: this.chargePointId,
          "connectors.connectorId": connectorId,
        },
        {
          $set: {
            "connectors.$.status": "Charging", // Status changes from 'Preparing' to 'Charging'
            "connectors.$.currentTransactionId": txnId,
          },
        }
      );

      // --- 6. Send CONFIRMATION to the Charge Point ---
      const confPayload = {
        // The IdTagInfo should reflect the current authorization status.
        idTagInfo: {
          status: "Accepted",
          // Optionally add parentIdTag, expiryDate
        },
        transactionId: txnId, // KEY: The CP must use this ID for all subsequent MeterValues and StopTransaction requests
      };

      // This utility function packages the response and sends it over the WebSocket.
      this.sendResult(messageId, confPayload);
    } catch (error) {
      console.error("Error handling StartTransaction:", error);

      // --- 7. Handle Error & Send SOAP/JSON Fault (or a non-Accepted CONF) ---
      // In a real system, you would log the error and send a specific OCPP fault response
      // if the database failed or validation failed.
      // logger.error(
      //   `Request Rejected by Central System — Policy or authorization failed : ${message}`
      // );
      logError({
        action: message[2],
        messageId: messageId,
        payload: payload,
        reason: "Error handling StartTransaction",
        stack: error.stack,
      });
      this.sendError(
        messageId,
        "GenericError",
        "Rejected by Central System: Policy or authorization failed.",
        {}
      );
    }
  }

  async handleMeterValues(messageId, payload, message) {
    console.log(`Received MeterValues from ${this.chargePointId}:`, payload);
    if (!(await this.validatePayload(MeterValuesSchema, payload))) {
      console.warn(`Validation failed for CP ${this.chargePointId}:`);
      logError({
        action: message[2],
        messageId: messageId,
        payload: payload,
        reason: "FormatViolation",
      });
      // logger.error(`Request rejected due to invalid schema ${message}`);
      return this.sendError(messageId, "FormatViolation", `Invalid payload`);
    }

    // --- 2. Extract Data from Payload ---
    const {
      connectorId,
      meterValue, // This is an array of MeterValue objects
      transactionId, // Optional field
    } = payload;

    try {
      // a. Lookup the Transaction (If applicable)
      // Find the active transaction in the database using the CS transaction ID
      const targetTransaction = await TransactionModel.findOne({
        csTransactionId: transactionId,
        isFinished: false, // Ensure the transaction is still active
      });

      if (!targetTransaction) {
        logger.error(
          `Received MeterValues for unknown or stale transaction ID: ${transactionId}. Proceeding to log data without internal transaction link.`
        );
        console.warn(
          `Received MeterValues for unknown or stale transaction ID: ${transactionId}. Proceeding to log data without internal transaction link.`
        );
        return this.sendResult(messageId, {});
      }

      console.debug(
        `Stored ${meterValue.length} meter value reading(s) for Connector ${connectorId}.`
      );

      // 3. Database Operation: Push the new readings into the 'readings' array
      const updateResult = await TransactionModel.updateOne(
        { _id: targetTransaction._id }, // Filter by internal document ID
        {
          // The $push operator appends the reading to the array
          // $each allows you to push multiple elements in a single operation
          $push: {
            readings: { $each: meterValue },
          },
        }
      );

      // --- 4. Send CONFIRMATION to the Charge Point ---
      // MeterValues.conf has an empty payload
      const confPayload = {};
      this.sendResult(messageId, confPayload);
    } catch (error) {
      console.error(
        `Internal Error storing MeterValues for CP ${this.chargePointId}:`,
        error
      );
      // logger.error(
      //   `Internal Error storing MeterValues for CP ${error.message}`
      // );
      logError({
        action: message[2],
        messageId: messageId,
        payload: payload,
        reason: "Internal Error storing MeterValues for CP ",
        stack: error.stack,
      });
      // IMPORTANT: The Central System MUST still respond with MeterValues.conf
      // even if its internal database operation fails, provided the message
      // format was valid (as per step 1).
      this.sendError(messageId, {});
    }
  }

  async handleStopTransaction(messageId, payload, message) {
    console.log(
      `Received StopTransaction from ${this.chargePointId}:`,
      payload
    );

    if (!(await this.validatePayload(StopTransactionSchema, payload))) {
      console.warn(`Validation failed for CP ${this.chargePointId}:`);
      logError({
        action: message[2],
        messageId: messageId,
        payload: payload,
        reason: "FormatViolation",
      });

      return this.sendError(messageId, "FormatViolation", `Invalid payload`);
    }

    // --- 2. Extract Data from Payload ---
    const {
      meterStop,
      timestamp,
      transactionId,
      reason = "local",
      idTag,
      transactionData = [],
    } = payload;

    try {
      // --- 4. Database Operation: find the Transaction in the DB ---
      const existingTxn = await TransactionModel.findOne({
        csTransactionId: transactionId,
        isFinished: false,
      });

      if (!existingTxn) {
        console.warn(`No active transaction found ${transactionId}`);
        logError({
          action: message[2],
          messageId: messageId,
          payload: payload,
          reason: "Not Found",
        });
        //  logger.error(`[${messageId}] Transaction not found or already stopped`);
        return this.sendError(
          messageId,
          "Transaction not found or already stopped"
        );
      }

      // --- update the transaction details ---
      existingTxn.meterStop = meterStop;
      existingTxn.stop_timestamp = timestamp;
      ((existingTxn.reason = reason), (existingTxn.isFinished = true));

      await existingTxn.save();

      console.debug(
        `Transaction ${transactionId} stopped successfully for CP ${this.chargePointId}`
      );

      // --- Update charge point connector status ---
      await chargePoint.updateOne(
        {
          serialNumber: this.chargePointId,
          "connectors.connectorId": existingTxn.connectorId,
        },
        {
          $set: {
            "connectors.$.status": "Available",
            "connectors.$.currentTransactionId": null,
          },
        }
      );

      const confPayload = {
        idTagInfo: {
          status: "Accepted",
        },
      };
      this.sendResult(messageId, confPayload);
    } catch (error) {
      console.error("Error handling StartTransaction:", error);
      logError({
        action: message[2],
        messageId: messageId,
        payload: payload,
        reason: "Error handling StartTransaction",
        stack: error.stack,
      });

      return this.sendError(
        messageId,
        "GenericError",
        "Internal error while processing StopTransaction."
      );
    }
  }

  async handleStatusNotification(messageId, payload, message) {
    const StatusNotificationSchema = {
      type: "object",
      properties: {
        // connectorId: REQUIRED, must be an integer >= 1
        connectorId: {
          type: "integer",
          minimum: 1,
        },

        // status: REQUIRED, must be one of the specified strings
        status: {
          type: "string",
          enum: [
            "Available",
            "Preparing",
            "Charging",
            "SuspendedEVSE",
            "SuspendedEV",
            "Finishing",
            "Reserved",
            "Unavailable",
            "Faulted",
          ],
        },

        // errorCode: REQUIRED, must be a string (usually "NoError")
        errorCode: {
          type: "string",
          maxLength: 50,
        },

        // timestamp: REQUIRED if status is not Available or Preparing
        timestamp: {
          type: "string",
          format: "date-time", // Ensures ISO 8601 format
        },

        // Optional Fields
        info: { type: "string", maxLength: 50 },
        vendorId: { type: "string", maxLength: 255 },
        vendorErrorCode: { type: "string", maxLength: 50 },
      },

      // Define the mandatory fields for the payload
      required: ["connectorId", "status", "errorCode"],

      // Disallow extra fields that are not part of the OCPP spec
      additionalProperties: false,
    };

    const result = await this.validatePayload(
      StatusNotificationSchema,
      payload
    );
    console.log("result", result);

    if (!result) {
      console.error("Validation Error for StatusNotification:", result);
      // logger.error(
      //   `Request rejected due to invalid schema: ${JSON.stringify({
      //     messageId,
      //     errorType: "TypeConstraintViolation",
      //     time: new Date().toISOString(),
      //   })}`
      // );
      logError({
        action: message[2],
        messageId: messageId,
        payload: payload,
        reason: "FormatViolation",
      });

      // 2. Reject the non-compliant message
      // Send a CALLERROR back to the CP instead of processing.
      this.sendError(
        messageId,
        "TypeConstraintViolation",
        "Payload fields did not meet OCPP specification."
      );
      return; // Stop processing
    }
    const { connectorId, status, errorCode } = payload;

    // Log the event for debugging
    console.log(
      `Received StatusNotification from ${this.chargePointId} ` +
        `for Connector ${connectorId}: ${status} (Error: ${errorCode || "None"})`
    );

    try {
      //  Update the database record
      const result = await updateConnectorStatus(
        this.chargePointId, // serialNumber
        status,
        connectorId
        // We can also pass errorCode if we want to save it
      );

      // check if errr in db
      if (!result) {
        //        logger.error(
        //   `[${messageId}] InternalError: Central System database update failed.`
        // );

        return this.sendError(
          messageId,
          "InternalError",
          "Central System database update failed."
        );
      }

      // send the confirmation back to the Charge Point
      // The StatusNotification.conf payload is empty {}
      this.sendResult(messageId, {});
    } catch (error) {
      console.error(
        `❌ DB update failed for StatusNotification from ${this.chargePointId}:`,
        error
      );
      // Even if the DB update fails, we typically send the confirmation
      // to prevent the CP from retrying, but log the error prominently.
      logError({
        action: message[2],
        messageId: messageId,
        payload: payload,
        reason: `❌ DB update failed for StatusNotification from ${this.chargePointId}:`,
        stack: error.stack,
      });
      logger.error(`Error updating the request ${message}`);
      this.sendError(messageId, {});
    }
  }

  changeAvailability(serialNumber, type, connectorId) {
    const messageId = "change-availability-" + Date.now();
    const requestPayload = {
      connectorId: parseInt(connectorId), // Ensure it's an integer
      type: type, // The command type: "Operative" or "Inoperative"
    };

    return new Promise(async (resolve, reject) => {
      this.callPromises.set(messageId, resolve(true));
      const message = [
        2, // Message Type ID: 2 (CALL for request)
        messageId,
        "ChangeAvailability",
        requestPayload, // The payload object
      ];

      try {
        // 2. Send the message
        logger.info(`Request from CSMS => ${message}`);
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        // 3. Reject if WebSocket send fails immediately (e.g., connection lost)
        this.callPromises.delete(messageId);
        reject(new Error(`WebSocket send failed: ${error.message}`));
      }
    });
  }

  async handleChangeConfiguration(chargePointId, key, value) {
    console.log("Change config:", chargePointId, key, value);

    const messageId = "change-Configuration-" + Date.now();
    const requestPayload = { chargePointId, key, value };
    const action = "ChangeConfiguration";

    // Construct the OCPP CALL message
    const message = [2, messageId, action, requestPayload];

    return new Promise(async (resolve, reject) => {
      // this.callPromises.set(messageId, resolve);
      const timeout = setTimeout(() => {
        if (this.callPromises) this.callPromises.delete(messageId);
        reject(
          new Error(
            `Timeout: CP ${chargePointId} did not respond to ${action} within 10 seconds.`
          )
        );
      }, 100000);

      if (!this.callPromises) {
        clearTimeout(timeout);
        return reject(
          new new Error(
            "Internal error: 'this.callPromises' is not available."
          )()
        );
      }
      this.callPromises.set(messageId, {
        resolve,
        reject,
        action,
        timeout,
        chargePointId,
        key,
        value,
      });
      console.log("callPromise");

      try {
        if (!this.ws && this.ws.readyState !== WebSocket.OPEN) {
          clearTimeout(timeout);
          this.callPromises.delete(messageId);
          reject(
            new Error(
              "WebSocket connection is not open. Failed to send message."
            )
          );
        }
        logger.info(`Request from CSMS => ${JSON.stringify(message)}`);
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        this.callPromises.delete(messageId);
        console.error(
          "Failed to send ChangeConfiguration or update DB:",
          error
        );
        reject(error);
      }
    });
  }

  async handleGetConfiguration(key) {
    console.log("get config:", key);

    const messageId = "get-Configuration-" + Date.now();
    const requestPayload = { key };
    const action = "GetConfiguration";

    // Construct the OCPP CALL message
    const message = [2, messageId, action, requestPayload];

    return new Promise(async (resolve, reject) => {
      // this.callPromises.set(messageId, resolve);
      const timeout = setTimeout(() => {
        if (this.callPromises) this.callPromises.delete(messageId);
        reject(
          new Error(
            `Timeout: CP ${chargePointId} did not respond to ${action} within 10 seconds.`
          )
        );
      }, 100000);

      if (!this.callPromises) {
        clearTimeout(timeout);
        return reject(
          new new Error(
            "Internal error: 'this.callPromises' is not available."
          )()
        );
      }
      this.callPromises.set(messageId, {
        resolve,
        reject,
        action,
        timeout,
        key,
      });
      console.log("callPromise");

      try {
        if (!this.ws && this.ws.readyState !== WebSocket.OPEN) {
          clearTimeout(timeout);
          this.callPromises.delete(messageId);
          reject(
            new Error(
              "WebSocket connection is not open. Failed to send message."
            )
          );
        }
        logger.info(`Request from CSMS => ${JSON.stringify(message)}`);
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        this.callPromises.delete(messageId);
        console.error(
          "Failed to send ChangeConfiguration or update DB:",
          error
        );
        reject(error);
      }
    });
  }

  // Handle a "CallResult" message (Response from a Central System initiated call)
  async handleCallResult(message) {
    const [type, messageId, payload] = message;
    if (type !== 3 || !payload || typeof payload !== "object") {
      console.error("Malformed CallResult:", message);
      return;
    }

    const callData = this.callPromises.get(messageId);
    if (!callData) {
      console.warn(`No promise found for messageId ${messageId}`);
      return;
    }

    const { resolve, action, timeout, chargePointId, key, value } = callData;
    let isValid = true;

    // Choose validation schema based on the action
    console.log("action", action);
    switch (action) {
      case "ChangeConfiguration":
        isValid = await this.validateChangeConfiguration(message);
        console.log("isvalid", isValid);
        if (isValid) {
          // Update DB here
          try {
            if (payload.status == "Accepted") {
              await chargePoint.findOneAndUpdate(
                { serialNumber: chargePointId },
                { heartbeatInterval: value }
                // { new: true }
              );
              await Configuration.findOneAndUpdate(
                { chargePointID: chargePointId, key: key },
                {
                  value: value,
                  status: payload.status,
                  updatedAt: new Date(),
                },
                { upsert: true, new: true }
              );
              console.log(
                `ChargePoint and configuration table ${chargePointId} updated: ${key} = ${value}`
              );
            }
          } catch (err) {
            console.error("Failed to update configuration in DB:", err);
          }
        }
        break;
      case "GetConfiguration":
        isValid = this.validateGetConfiguration(message, action);
        break;
      case "RemoteStopTransaction":
        isValid = this.validateRemoteStopTransactionConf(message, action);
        break;

      default:
        console.warn(`No schema found for action: ${action}`);
    }
    // console.warn(`No promise for messageId ${messageId}`);

    // Validate payload (if schema exists)
    if (!isValid) {
      console.error(`Validation failed for ${action}`, payload);
      this.callPromises.delete(messageId);
      return;
    }
    resolve(payload);
    this.callPromises.delete(messageId);
  }

  async validateRemoteStopTransactionConf(message, action) {
    const [messageType, messageId, payload] = message;

    const schema = {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["Accepted", "Rejected"],
        },
      },
      required: ["status"],
      additionalProperties: false,
    };

    const valid = await this.validatePayload(schema, payload);
    if (!valid) {
      console.error(`Validation failed for ${action} :`, valid);
      logError({
        action,
        messageId,
        payload,
        reason: "FormatViolation",
      });

      return valid;
    }
  }

  async validateChangeConfiguration(message, action) {
    const [messageType, messageId, payload] = message;
    console.log("message=======>>>>>>>>>", payload);

    const schema = {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["Accepted", "Rejected"],
        },
      },
      required: ["status"],
      additionalProperties: false,
    };

    const valid = await this.validatePayload(schema, payload);
    if (!valid) {
      console.error(`Validation failed for ${action} :`, valid);
      logError({
        action,
        messageId,
        payload,
        reason: "FormatViolation",
      });
    }
    return valid;
  }

  async validateGetConfiguration(message, action) {
    const [messageType, messageId, payload] = message;
    console.log("message=======>>>>>>>>>", payload);

    const schema = {
      type: "object",
      properties: {
        configurationKey: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              readonly: { type: "boolean" },
              value: { type: "string" },
            },
            required: ["key", "readonly", "value"],
            additionalProperties: false,
          },
        },
        unknownKey: {
          type: "array",
          items: { type: "string" },
        },
      },
      additionalProperties: false,
    };

    const valid = await this.validatePayload(schema, payload);
    if (!valid) {
      console.error(`Validation failed for ${action} :`, valid);
      logError({
        action,
        messageId,
        payload,
        reason: "FormatViolation",
      });
    }
    return valid;
  }
  // Handle a "CallError" message
  handleCallError(message) {
    const [messageType, messageId, errorCode, errorDescription, errorDetails] =
      message;
    const reject = this.callPromises.get(messageId);
    if (reject) {
      logError({
        // action: message[2],
        error: errorDescription,
        messageId: messageId,
        // payload: payload,
        reason: errorDescription,
        stack: errorDetails,
      });
      logger.error(`OCPP Error: ${errorDescription} (${errorCode}`);
      reject(new Error(`OCPP Error: ${errorDescription} (${errorCode})`));
      this.callPromises.delete(messageId);
    }
  }

  // Send a "CallResult" response back to the Charge Point
  sendResult(messageId, payload) {
    // console.log("payload=========>>>>>>>", payload);
    const response = [3, messageId, payload];
    if (payload.status == "Rejected") {
      logger.error(`Rejected response :${response}`);
    }
    logger.info(`-> Response to CP: ${JSON.stringify(response)}`);
    // console.info("sendResult", response);
    this.ws.send(JSON.stringify(response));
  }

  // Send a "CallError" response back to the Charge Point
  sendError(messageId, errorCode, errorDescription) {
    const response = [4, messageId, errorCode, errorDescription, {}];
    logger.error(`CallError: ${response}`);
    logError({
      error: errorCode,
      messageId: messageId,
      reason: errorDescription,
    });
    this.ws.send(JSON.stringify(response));
  }
  // Handle a "Call" message (Charge Point initiated)
}

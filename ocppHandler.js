// ocppHandler.js
import Ajv from "ajv";
import addFormats from "ajv-formats";
import chargePoint from "./models/chargePoint.js";
import logger from "./logger.js";
import idTag from "./models/IdTag.js";
import {
  createAndUpdateBootnotification,
  updateConnectorStatus,
  changeConfigUpdate,
} from "./services/queries.js";
import TransactionModel from "./models/transaction.js";
import StartTransactionSchema from "./jsonSchemas/StartTransaction.json" with { type: "json" };
import StopTransactionSchema from "./jsonSchemas/StopTransaction.json" with { type: "json" };
import MeterValuesSchema from "./jsonSchemas/MeterValuesSchema.json" with { type: "json" };
import { logError } from "./Utilitiy/LoggerHelper.js";
import IdTag from "./models/IdTag.js";
import Reservation from "./models/reservation.js";
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
          logger.info(`CP -> CSMS : ${message}`);
          this.handleCall(parsedMessage);
          break;
        case 3: // CallResult
          logger.info(`CP -> CSMS : ${message}`);
          this.handleCallResult(parsedMessage);
          break;
        case 4: // CallError
          this.handleCallError(parsedMessage);
          break;
        default:
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
        messageId,
        payload,
        reason: "FormatViolation",
      });

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

  /**
   * Handles the Authorize request from a Charge Point and responds with authorization status.
   *
   * @async
   * @param {string} messageId - The unique identifier of the incoming OCPP message.
   * @param {object} payload - The Authorize.req payload containing the `idTag` to be validated.
   * @param {Array} message - The full OCPP message array in the format [messageTypeId, messageId, payload].
   * @returns {Promise<void>} A Promise that resolves after sending the Authorize.conf response or an error message.
   *
   **/

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
        messageId,
        payload,
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
      console.error(
        `Error validating authorize request for idTag=${payload.idTag}`,
        err
      );
      return this.sendError(messageId, { idTagInfo: { status: "Error" } });
    }
  }

  /**
   * Handles the Heartbeat request from a Charge Point and responds with the current time.
   *
   * @async
   * @param {string} messageId - The unique identifier of the incoming OCPP message.
   * @param {Array} message - The OCPP Heartbeat message array in the format [messageTypeId, messageId, payload].
   * @returns {Promise<void>} A Promise that resolves after updating the Charge Point record
   * and sending the Heartbeat confirmation (Heartbeat.conf) response.
   *
   */

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
      return this.sendError(
        messageId,
        "GenericError",
        "Internal error while processing Heartbeat."
      );
    }
  }

  /**
   * Handles the StartTransaction request from a Charge Point and initiates a new charging session.
   *
   * @async
   * @param {string} messageId - The unique identifier of the incoming OCPP message.
   * @param {object} payload - The StartTransaction.req payload containing connector and transaction details.
   * @param {Array} message - The full OCPP message array in the format [messageTypeId, messageId, payload].
   * @returns {Promise<void>} A Promise that resolves after creating the transaction record and sending the StartTransaction.conf response.
   **/
  async handleStartTransaction(messageId, payload, message) {
    console.log(
      `Received StartTransaction from ${this.chargePointId}:`,
      payload
    );

    if (!(await this.validatePayload(StartTransactionSchema, payload))) {
      console.warn(`Validation failed for CP ${this.chargePointId}:`);
      logError({
        action: message[2],
        messageId,
        payload,
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
      return this.sendResult(messageId, confPayload);
    } catch (error) {
      console.error("Error handling StartTransaction:", error);

      // --- 7. Handle Error & Send SOAP/JSON Fault (or a non-Accepted CONF) ---
      // In a real system, you would log the error and send a specific OCPP fault response
      // if the database failed or validation failed.

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
        "Rejected by Central System: Policy or authorization failed.",
        {}
      );
    }
  }

  /**
   * Handles the MeterValues request from a Charge Point and initiates a new charging session.
   *
   * @async
   * @param {string} messageId - The unique identifier of the incoming OCPP message.
   * @param {object} payload - The StartTransaction.req payload containing connector and transaction details.
   * @param {Array} message - The full OCPP message array in the format [messageTypeId, messageId, payload].
   * @returns {Promise<void>} A Promise that resolves after creating the transaction record and sending the StartTransaction.conf response.
   **/
  async handleMeterValues(messageId, payload, message) {
    console.log(`Received MeterValues from ${this.chargePointId}:`, payload);
    if (!(await this.validatePayload(MeterValuesSchema, payload))) {
      console.warn(`Validation failed for CP ${this.chargePointId}:`);
      logError({
        action: message[2],
        messageId,
        payload,
        reason: "FormatViolation",
      });
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
        messageId,
        payload,
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
          messageId,
          payload,
          reason: "Not Found",
        });
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
      logError({
        action: message[2],
        messageId,
        payload,
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
      this.sendError(messageId, {});
    }
  }

  changeAvailability(serialNumber, type, connectorId) {
    const messageId = "change-availability-" + Date.now();
    const requestPayload = {
      connectorId: parseInt(connectorId), // Ensure it's an integer
      type: type, // command type: "Operative" or "Inoperative"
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
        logger.info(`CSMS -> CP ${message}`);
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
        logger.info(`CSMS -> CP : ${JSON.stringify(message)}`);
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
            `Timeout: CP  did not respond to ${action} within 10 seconds.`
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
        logger.info(`CSMS -> CP : ${JSON.stringify(message)}`);
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

  mapIdTagToAuthorizationData(idTagDoc) {
    return {
      idTag: idTagDoc.idTag,
      idTagInfo: {
        status: idTagDoc.status,
        parentIdTag: idTagDoc.parentTag || undefined,
        expiryDate: idTagDoc.expiryDate?.toISOString(),
      },
    };
  }

  async sendLocalList(listVersion = Date.now()) {
    try {
      // 1. Fetch idTags from DB
      const tags = await IdTag.find({});

      // 2. Convert DB → OCPP AuthorizationData
      const localAuthorizationList = tags.map((t) =>
        this.mapIdTagToAuthorizationData(t)
      );

      // 3. Generate OCPP message ID
      const messageId = "SendLocalList_" + Date.now();

      // 4. Build OCPP CALL message
      const ocppMessage = [
        2,
        messageId,
        "SendLocalList",
        {
          listVersion,
          updateType: "Full",
          localAuthorizationList,
        },
      ];

      // 5. Send to CP
      this.ws.send(JSON.stringify(ocppMessage));
      logger.info(`CSMS -> CP : ${JSON.stringify(ocppMessage)}`);
      console.log("📤 SendLocalList.req => CP", this.cpId);

      return { success: true, messageId };
    } catch (error) {
      console.error("❌ Error in sendLocalList:", error);
      return { success: false, error: error.message };
    }
  }

  async reserveNow({ connectorId, idTag, parentIdTag = null, expiryDate }) {
    return new Promise(async (resolve, reject) => {
      try {
        const action = "ReserveNow";
        const messageId = `${action}-${Date.now()}`;
        const reservationId = Math.floor(Math.random() * 100000);

        // 1. Build payload
        const payload = {
          connectorId,
          expiryDate,
          idTag,
          reservationId,
        };

        if (parentIdTag) payload.parentIdTag = parentIdTag;

        // 2. Create OCPP CALL message
        const ocppMessage = [
          2, // CALL
          messageId, // message ID
          action, // Action: ReserveNow
          payload, // Payload
        ];

        // 3. Setup timeout promise
        const timeout = setTimeout(() => {
          if (this.callPromises) this.callPromises.delete(messageId);
          reject(
            new Error(
              `Timeout: CP did not respond to ${action} within 10 seconds.`
            )
          );
        }, 10000);

        // 4. Validate callPromises map exists
        if (!this.callPromises) {
          clearTimeout(timeout);
          return reject(
            new Error("Internal error: 'this.callPromises' is not available.")
          );
        }

        // 5. Register resolver so CP response can resolve it
        this.callPromises.set(messageId, {
          resolve,
          reject,
          action,
          timeout,
          reservationData: {
            connectorId,
            idTag,
            parentIdTag,
            expiryDate,
            reservationId,
          },
        });

        // 6. Validate WebSocket
        if (!this.ws || this.ws.readyState !== 1) {
          clearTimeout(timeout);
          this.callPromises.delete(messageId);

          return reject(
            new Error(
              "WebSocket connection is not open. Could not send ReserveNow message."
            )
          );
        }

        // 7. Log and send message to CP
        logger.info(`CSMS -> CP : ${JSON.stringify(ocppMessage)}`);
        this.ws.send(JSON.stringify(ocppMessage));

        console.log(`📤 ReserveNow.req sent to CP (${this.cpId})`);
      } catch (error) {
        console.error("❌ Error sending ReserveNow:", error);
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
        await changeConfigUpdate(isValid, payload, chargePointId, value, key);
        // console.log("isvalid", isValid);
        break;
      case "GetConfiguration":
        isValid = this.validateGetConfiguration(message, action);
        break;

      case "RemoteStopTransaction":
        isValid = this.validateRemoteStopTransactionConf(message, action);
        break;

      case "RemoteStartTransaction":
        isValid = this.validateRemoteStartTransactionConf(message, action);
        break;

      case "SendLocalList":
        isValid = this.validateSendLocalListConf(message, action);
        break;

      case "ReserveNow":
        isValid = this.validateReserveNowConf(message, action);
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

  // Handle a "CallError" message
  handleCallError(message) {
    const [messageType, messageId, errorCode, errorDescription, errorDetails] =
      message;
    const reject = this.callPromises.get(messageId);
    if (reject) {
      logError({
        error: errorDescription,
        messageId,
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
    logger.info(`CSMS -> CP : ${JSON.stringify(response)}`);
    // console.info("sendResult", response);
    this.ws.send(JSON.stringify(response));
  }

  // Send a "CallError" response back to the Charge Point
  sendError(messageId, errorCode, errorDescription) {
    const response = [4, messageId, errorCode, errorDescription, {}];
    logger.error(`CallError: ${response}`);
    logError({
      error: errorCode,
      messageId,
      reason: errorDescription,
    });
    this.ws.send(JSON.stringify(response));
  }

  /**
   * Sends a RemoteStartTransaction request to a specific Charge Point and waits for the confirmation.
   * @param {string} serialNumber - The unique identifier of the target CP.
   * @param {object} payload - The OCPP payload (idTag, connectorId, chargingProfile).
   * @returns {Promise<object>} Resolves updatedCPwith the RemoteStartTransaction.conf payload.
   */
  sendRemoteStart(serialNumber, ocppPayload) {
    console.log("sendRemoteStart=>>", serialNumber, ocppPayload);
    const messageId = "RemoteStartTransaction-" + Date.now();
    const action = "RemoteStartTransaction";

    // 1. Construct the OCPP-J message array
    const ocppMessage1 = [2, messageId, action, ocppPayload];

    return new Promise((resolve, reject) => {
      // Set up a timeout to handle cases where the CP is slow or unresponsive
      const timeout = setTimeout(() => {
        this.callPromises.delete(messageId);
        reject(
          new Error(
            `Timeout: CP ${serialNumber} did not respond to ${action} within 10 seconds.`
          )
        );
      }, 10000);

      // 2. Store the Promise resolver/rejecter for later use
      this.callPromises.set(messageId, {
        timeout,
        resolve,
        reject,
        action,
      });

      try {
        // 2. Send the message
        logger.info(`CSMS -> CP : ${JSON.stringify(ocppMessage1)}`);
        this.ws.send(JSON.stringify(ocppMessage1));
        // return this.sendResult(messageId, { currentTime: now.toISOString() });
      } catch (error) {
        clearTimeout(timeout);
        // 3. Reject if WebSocket send fails immediately (e.g., connection lost)
        this.callPromises.delete(messageId);
        reject(
          new Error(`Failed to send message over WebSocket: ${error.message}`)
        );
      }
    });
  }

  /**
   * @param {string} serialNumber - The unique identifier of the Charge Point.
   * @param {object} ocppPayload - The payload for RemoteStopTransaction.req.
   * Must contain the 'transactionId' (e.g., { transactionId: 123 }).
   * @returns {Promise<object>} A Promise that resolves with the RemoteStopTransaction.conf payload
   * or rejects on timeout or send failure.
   */

  sendRemoteStop(serialNumber, ocppPayload) {
    // 1. Define message action and generate a unique message ID
    const action = "RemoteStopTransaction";
    const messageId = "RemoteStopTransaction" + "-" + Date.now();

    // ocppPayload must contain the transactionId: { "transactionId": 12345 }
    // 2. Construct the OCPP-J message array (Call type = 2)
    const ocppMessage = [2, messageId, action, ocppPayload];

    // NOTE: This assumes 'this.ws' (WebSocket instance) and 'this.callPromises' (Map)
    // are available in the scope where this function is executed, mimicking your class structure.
    return new Promise((resolve, reject) => {
      // Set up a timeout for the Charge Point's response (RemoteStopTransaction.conf)
      const timeout = setTimeout(() => {
        if (this.callPromises) this.callPromises.delete(messageId);

        reject(
          new Error(
            `Timeout: CP ${serialNumber} did not respond to ${action} within 10 seconds.`
          )
        );
      }, 10000); // 10 seconds timeout

      // 3. Store the Promise resolver/rejecter for when the confirmation comes back
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
      });
      console.log("callPromises");

      try {
        // 4. Send the message over the established WebSocket connection
        if (!this.ws && this.ws.readyState !== WebSocket.OPEN) {
          clearTimeout(timeout);
          this.callPromises.delete(messageId);
          reject(
            new Error(
              "WebSocket connection is not open. Failed to send message."
            )
          );
        }
        logger.info(`CSMS -> CP : ${JSON.stringify(ocppMessage)}`);
        this.ws.send(JSON.stringify(ocppMessage));
        console.log(
          `Sent ${action} request (ID: ${messageId}) to CP ${serialNumber}.`
        );
      } catch (e) {
        clearTimeout(timeout);
        // 5. Reject if WebSocket send fails immediately (e.g., serialization error or connection issue)
        this.callPromises.delete(messageId);
        reject(
          new Error(`Failed to send message over WebSocket: ${e.message}`)
        );
      }
    });
  }

  async validateRemoteStartTransactionConf(message, action) {
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

  /**
   * Validates the ChangeConfiguration confirmation payload received from the Charge Point.
   *
   * @async
   * @param {Array} message - The OCPP message array in the format [messageTypeId, messageId, payload].
   * @param {string} action - The OCPP action name, e.g., "ChangeConfiguration".
   * @returns {Promise<boolean>} A Promise that resolves to `true` if the payload is valid,
   * otherwise `false` if the validation fails.
   *
   */

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

  /**
   * Validates the GetConfiguration confirmation payload received from the Charge Point.
   *
   * @async
   * @param {Array} message - The OCPP message array in the format [messageTypeId, messageId, payload].
   * @param {string} action - The OCPP action name, e.g., "GetConfiguration".
   * @returns {Promise<boolean>} A Promise that resolves to `true` if the payload is valid,
   * otherwise `false` if the validation fails.
   *
   */

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

  async validateSendLocalListConf(message, action) {
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

  async validateReserveNowConf(message, action) {
    const [messageType, messageId, payload] = message;
    const entry = this.callPromises.get(messageId);
    if (!entry) {
      console.error("❌ No pending reservation found for", messageId);
      return false;
    }
    const { resolve, reject, timeout, reservationData } = entry;
    const { connectorId, idTag, parentIdTag, expiryDate, reservationId } =
      reservationData;

    clearTimeout(timeout);
    this.callPromises.delete(messageId);

    // console.log("message=======>>>>>>>>>", message[2].status);
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
    // console.log("payload status", payload.status);
    if (payload.status === "Accepted") {
      await Reservation.create({
        connectorId,
        idTag,
        parentIdTag: parentIdTag || null,
        expiryDate,
        reservationId,
        status: "Active",
      });
    }

    return valid;
  }
}

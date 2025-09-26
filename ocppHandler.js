// ocppHandler.js
import Ajv from "ajv";
const ajv = new Ajv();
import chargePoint from "./models/chargePoint.js";

import logger from "./logger.js";
import idTagInfo from "./models/IdTagInfo.js";
import {
  createAndUpdateBootnotification,
  updateConnectorStatus
} from "./services/queries.js";


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
        this.handleBootNotification(messageId, payload);
        break;
      case "Authorize":
        this.handleAuthorize(messageId, payload);
        break;
      case "StartTransaction":
        // The Charge Point SHOULD deliver transaction-related messages to the Central System in chronological order as soon as possible.
        this.handleStartTransaction(messageId, payload);
        break;
      case "StopTransaction":
        this.handleStopTransaction(messageId, payload);
        break;
      case "Heartbeat":
        this.handleHeartbeat(messageId, payload);
        break;
      case "MeterValues":
        this.handleMeterValues(messageId, payload);
        break;
      default:
        console.warn(`Unsupported action: ${action}`);
        // Send a CallError response for unsupported actions
        this.sendError(messageId, "NotImplemented", "Action not supported");
        logger.info(`Unsupported action: ${action}`);
        break;
    }
  }

  // Implement handlers for each OCPP action
  async handleBootNotification(messageId, payload) {
    console.log(`Received BootNotification from ${this.chargePointId}:`);

    const bootNotificationSchema = {
      type: "object",
      properties: {
        chargePointVendor: { type: "string", minLength: 4, maxLength: 20 },
        chargePointModel: { type: "string", minLength: 4, maxLength: 20 },
      },
      required: ["chargePointVendor", "chargePointModel"],
    };

    if (
      !(await this.validateBootNotification(bootNotificationSchema, payload))
    ) {
      console.warn("*** ❌ Bad request****",)
      return this.sendError(messageId, {
        status: "Rejected",
        currentTime: new Date().toISOString(),
        interval: 0,
      });
    }

    await createAndUpdateBootnotification(payload, this)

    const responsePayload = {
      status: "Accepted",
      currentTime: new Date().toISOString(),
      heartbeatInterval: 300, // seconds
    };
    return this.sendResult(messageId, responsePayload);
  }


  async validateBootNotification(bootNotificationSchema, payload) {
    const validate = ajv.compile(bootNotificationSchema);
    return validate(payload);
  }

  async handleAuthorize(messageId, payload) {
    // Calculate expiryDate: 30 days from now
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30); // +30 days
    const expiryISO = expiryDate.toISOString();

    console.log(`Received Authorize from ${this.chargePointId}:`, payload);

    const authorizeSchema = {
      type: "object",
      properties: {
        idTag: { type: "string" },
      },
      required: ["idTag"],
    };

    if (!(await this.validateBootNotification(authorizeSchema, payload))) {
      return this.sendResult(messageId, {
        status: "Rejected",
      });
    }
    await idTagInfo.findOneAndUpdate(
      { idTagInfo: payload.idTag },
      {
        $set: {
          status: "Accepted",
          expiryDate: expiryISO,
          parentTag: null,
        },
      },
      {
        upsert: true,
        runValidator: true,
        strict: false,
      }
    );
    // Logic to check `idTag` in database
    const responsePayload = {
      idTagInfo: {
        status: "Accepted",
        expiryDate: expiryISO,
        parentTag: payload.parentTag,
      },
    };
    this.sendResult(messageId, responsePayload);
  }

  async handleStartTransaction(messageId, payload) {
    console.log(
      `Received StartTransaction from ${this.chargePointId}:`,
      payload
    );
    // Logic to create a new transaction record in MongoDB
    const responsePayload = {
      idTagInfo: {
        status: "Accepted",
      },
      transactionId: 1001, // Example transaction ID
    };
    this.sendResult(messageId, responsePayload);
  }

  async handleStopTransaction(messageId, payload) {
    console.log(
      `Received StopTransaction from ${this.chargePointId}:`,
      payload
    );
    // Logic to update the transaction record in MongoDB
    const responsePayload = {
      idTagInfo: {
        status: "Accepted",
      },
    };
    this.sendResult(messageId, responsePayload);
  }

  async handleHeartbeat(messageId, payload) {
    console.log(`Received Heartbeat from ${this.chargePointId}`);
    const responsePayload = {
      currentTime: new Date().toISOString(),
    };
    this.sendResult(messageId, responsePayload);
    await chargePoint.findOneAndUpdate(
      { serialNumber: this.chargePointId },
      {
        $set: { lastboot: new Date() },
        $setOnInsert: { serialNumber: this.chargePointId },
      },
      { upsert: true, runValidators: true }
    );
  }

  async handleMeterValues(messageId, payload) {
    console.log(`Received MeterValues from ${this.chargePointId}:`, payload);
    // Logic to save meter values to MongoDB
    this.sendResult(messageId, {});
  }

  changeAvailability(serialNumber, type, connectorId) {
    const messageId = "change-availability-" + Date.now();
    const responsePayload = {
      status: "Accepted",
      connectorId
    };

    return new Promise(async (resolve, reject) => {
      this.callPromises.set(messageId, resolve(true));
      const query = await updateConnectorStatus(serialNumber, type, connectorId)
      console.log("query",query)
      if (!query) {
        return this.sendError(messageId, {
          status: "Rejected",
        });
      }
      this.sendResult(messageId, responsePayload);
    });
  }

  // Handle a "CallResult" message (Response from a Central System initiated call)
  handleCallResult(message) {
    const [messageType, messageId, payload] = message;
    const resolve = this.callPromises.get(messageId);
    if (resolve) {
      resolve(payload);
      this.callPromises.delete(messageId);
    }
  }

  // Handle a "CallError" message
  handleCallError(message) {
    const [messageType, messageId, errorCode, errorDescription, errorDetails] =
      message;
    const reject = this.callPromises.get(messageId);
    if (reject) {
      reject(new Error(`OCPP Error: ${errorDescription} (${errorCode})`));
      this.callPromises.delete(messageId);
    }
  }

  // Send a "CallResult" response back to the Charge Point
  sendResult(messageId, payload) {
    const response = [3, messageId, payload];
    console.log("Response", response);
    logger.info(`-> Response to CP: ${JSON.stringify(response)}`);
    console.info("sendResult", response);
    this.ws.send(JSON.stringify(response));
  }

  // Send a "CallError" response back to the Charge Point
  sendError(messageId, errorCode, errorDescription) {
    const response = [4, messageId, errorCode, errorDescription, {}];
    this.ws.send(JSON.stringify(response));
  }

}

// ocppHandler.js
import Ajv from "ajv";
const ajv = new Ajv();
import chargePoint from "./models/chargePoint.js";
import logs from "./models/logs.js";

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
      console.log("parsedMessage", parsedMessage);
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
    console.log("message", message);
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
        break;
    }
  }

  // Implement handlers for each OCPP action
  async handleBootNotification(messageId, payload) {
    // console.log(`Received BootNotification from ${this.chargePointId}:`, payload);
    // Logic to validate Charge Point and save to MongoDB
    const bootNotificationSchema = {
      type: "object",
      properties: {
        chargePointVendor: { type: "string" },
        chargePointModel: { type: "string" },
      },
      required: ["chargePointVendor", "chargePointModel"],
    };

    if (
      !(await this.validateBootNotification(bootNotificationSchema, payload))
    ) {
      // console.log("Bad response",)

      return this.sendResult(messageId, {
        status: "Rejected",
        currentTime: new Date().toISOString(),
        interval: 0,
      });
    }

    // console.log("Bad", payload)
    const update = {
      vendor: payload.chargePointVendor,
      model: payload.chargePointModel,
      serialNumber: this.chargePointId,
      firmwareVersion: payload.firmwareVersion,
      lastBoot: new Date(),
      status: "Accepted",
      heartbeatInterval: 300,
    };

    const options = {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      runValidators: true, //
    };

    await chargePoint.findOneAndUpdate(
      {
        serialNumber: this.chargePointId,
      },
      update,
      options
    );

    const responsePayload = {
      status: "Accepted",
      currentTime: new Date().toISOString(),
      heartbeatInterval: 300, // seconds
    };
    this.sendResult(messageId, responsePayload);
  }

  async validateBootNotification(bootNotificationSchema, payload) {
    const validate = ajv.compile(bootNotificationSchema);
    return validate(payload);
  }

  async handleAuthorize(messageId, payload) {
    console.log(`Received Authorize from ${this.chargePointId}:`, payload);
    // Logic to check `idTag` in database
    const responsePayload = {
      idTagInfo: {
        status: "Accepted",
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
    this.ws.send(JSON.stringify(response));
  }

  // Send a "CallError" response back to the Charge Point
  sendError(messageId, errorCode, errorDescription) {
    const response = [4, messageId, errorCode, errorDescription, {}];
    this.ws.send(JSON.stringify(response));
  }
}

// module.exports = OcppHandler;

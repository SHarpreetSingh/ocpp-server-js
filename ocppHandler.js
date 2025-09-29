// ocppHandler.js
import Ajv from "ajv";
import addFormats from "ajv-formats"
import chargePoint from "./models/chargePoint.js";

import logger from "./logger.js";
import idTag from "./models/IdTag.js";
import {
  createAndUpdateBootnotification,
  updateConnectorStatus
} from "./services/queries.js";

const ajv = new Ajv();
addFormats(ajv)


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
        this.handleHeartbeat(messageId);
        break;
      case "MeterValues":
        this.handleMeterValues(messageId, payload);
        break;
      case 'StatusNotification':
        // 3. If valid, process the message
        this.handleStatusNotification(messageId, payload);
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
      !(await this.validatePayload(bootNotificationSchema, payload))
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

  // async validateBootNotification(bootNotificationSchema, payload) {
  //   const validate = ajv.compile(bootNotificationSchema);
  // }

  async validatePayload(ActionSchema, payload) {
    const validate = ajv.compile(ActionSchema);
    return validate(payload);
  }

  // async validateJsonSchema(jsonSchema, payload) {
  //   const validate = ajv.compile(jsonSchema);
  //   return validate(payload);
  // }

  async handleAuthorize(messageId, payload) {
    console.log(`Received Authorize from ${this.chargePointId}:`, payload);

    const authorizeSchema = {
      type: "object",
      properties: {
        idTag: { type: "string", minLength: 4, maxLength: 20 },
      },
      required: ["idTag"],
    };

    if (!(await this.validatePayload(authorizeSchema, payload))) {
      console.warn("*** ❌ Bad request****",)
      return this.sendResult(messageId, {
        status: "Rejected",
      });
    }
    try {
       const IDTAG = await idTag.findOne({ idTagInfo: payload.idTag });
    
    let idtaginfo;
    const now = new Date();
    if (!IDTAG) {
      idtaginfo = { status: "Invalid" };
    } else if (IDTAG.expiryDate && IDTAG.expiryDate < now) {
      idtaginfo = { status: "Expired", expiryDate: IDTAG.expiryDate,parentTag: IDTAG.parentTag, };
    } else {
      idtaginfo = {
        status: "Accepted",
        expiryDate: IDTAG.expiryDate,
        parentTag: IDTAG.parentTag,
      };
    }
     console.log(`Authorize result for ${payload.idTag}: ${idTagInfo.status}`);
    this.sendResult(messageId, { idtaginfo:idtaginfo });
    } catch (err) {
      console.error(`Error validating authorize request for idTag=${payload.idTag}`, err);
      this.sendResult(messageId, { idTagInfo: { status: "Error" } });
    }
   
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

  async handleHeartbeat(messageId) {
    const now = new Date();
    console.log(`[${new Date().toISOString()}] Heartbeat received from ${this.chargePointId}`);

    this.sendResult(messageId, {currentTime: now.toISOString()});

    try{
      await chargePoint.findOneAndUpdate(
      { serialNumber: this.chargePointId },
      {
        $set: { lastboot: now},
        $setOnInsert: { serialNumber: this.chargePointId },
      },
      { upsert: true, runValidators: true }
    );
    }catch(err){
        console.error(`Error updating heartbeat for ${this.chargePointId}`, err);
    }
  }

  async handleMeterValues(messageId, payload) {
    console.log(`Received MeterValues from ${this.chargePointId}:`, payload);
    // Logic to save meter values to MongoDB
    this.sendResult(messageId, {});
  }


  async handleStatusNotification(messageId, payload) {
    const StatusNotificationSchema = {
      type: "object",
      properties: {
        // connectorId: REQUIRED, must be an integer >= 1
        connectorId: {
          type: "integer",
          minimum: 1
        },

        // status: REQUIRED, must be one of the specified strings
        status: {
          type: "string",
          enum: [
            "Available", "Preparing", "Charging", "SuspendedEVSE",
            "SuspendedEV", "Finishing", "Reserved", "Unavailable",
            "Faulted"
          ]
        },

        // errorCode: REQUIRED, must be a string (usually "NoError")
        errorCode: {
          type: "string",
          maxLength: 50
        },

        // timestamp: REQUIRED if status is not Available or Preparing
        timestamp: {
          type: "string",
          format: "date-time" // Ensures ISO 8601 format
        },

        // Optional Fields
        info: { type: "string", maxLength: 50 },
        vendorId: { type: "string", maxLength: 255 },
        vendorErrorCode: { type: "string", maxLength: 50 }
      },

      // Define the mandatory fields for the payload
      required: ["connectorId", "status", "errorCode"],

      // Disallow extra fields that are not part of the OCPP spec
      additionalProperties: false
    };

    const result = await this.validatePayload(StatusNotificationSchema, payload)
    console.log("result", result)

    if (!result) {
      console.error('Validation Error for StatusNotification:', result);
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
      `for Connector ${connectorId}: ${status} (Error: ${errorCode || 'None'})`
    );

    try {
      //  Update the database record
      await updateConnectorStatus(
        this.chargePointId, // serialNumber
        status,
        connectorId,
        // We can also pass errorCode if we want to save it
      );

      // send the confirmation back to the Charge Point
      // The StatusNotification.conf payload is empty {}
      this.sendResult(messageId, {});

    } catch (error) {
      console.error(`❌ DB update failed for StatusNotification from ${this.chargePointId}:`, error);
      // Even if the DB update fails, we typically send the confirmation 
      // to prevent the CP from retrying, but log the error prominently.
      this.sendError(messageId, {});
    }
  }


  changeAvailability(serialNumber, type, connectorId) {
    const messageId = "change-availability-" + Date.now();
    const requestPayload = {
        connectorId: parseInt(connectorId), // Ensure it's an integer
        type: type // The command type: "Operative" or "Inoperative"
    };

    return new Promise(async (resolve, reject) => {
      this.callPromises.set(messageId, resolve(true));
      const message = [
        2,                     // Message Type ID: 2 (CALL for request)
        messageId,             
        "ChangeAvailability",  
        requestPayload         // The payload object
      ]

      this.ws.send(JSON.stringify(message));
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

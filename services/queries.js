//services/queries.js
import chargePoint from "../models/chargePoint.js";
// import transaction from "../models/transaction.js";
import { logError } from "../Utilitiy/LoggerHelper.js";
import Configuration from "../models/configuration.js";
export async function createAndUpdateBootnotification(
  payload,
  ocppHandler,
  messageId,
  message
) {
  const update = {
    vendor: payload.chargePointVendor,
    model: payload.chargePointModel,
    serialNumber: ocppHandler.chargePointId,
    firmwareVersion: payload.firmwareVersion,
    lastBoot: new Date(),
    status: "Accepted",
    heartbeatInterval: 300,
    connectors: payload.connectors,
  };

  const options = {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
    runValidators: true, //
  };

  try {
    const createAndUpdtCP = await chargePoint.findOneAndUpdate(
      {
        serialNumber: ocppHandler.chargePointId,
      },
      update,
      options
    );

    console.log("createAndUpdtCP", createAndUpdtCP);
    if (!createAndUpdtCP) {
      console.log(`Charge Point ${ocppHandler.chargePointId} or  not found.`);
      logger.error(`Rejected Request due to missing Charge Point : 
                ${message}, ${JSON.stringify({
                  status: "Rejected",
                  currentTime: new Date().toISOString(),
                  interval: 0,
                })}`);
      return ocppHandler.sendError(messageId, {
        status: "Rejected",
        currentTime: new Date().toISOString(),
        interval: 0,
      });
    }
    console.log(
      `created or updated  serialNumber:${ocppHandler.chargePointId}`
    );
    return true;
  } catch (error) {
    console.error("Error updating connector status:", error);

    return ocppHandler.sendError(messageId, {
      status: "Rejected",
      currentTime: new Date().toISOString(),
      interval: 0,
    });
  }
}

/**
 * Checks the database to confirm if the specified connector on the target
 * Charge Point is available for a new remote transaction.
 * * @param {string} serialNumber - The unique identifier of the Charge Point.
 * @param {number} connectorId - The ID of the connector to check (e.g., 1).
 * @returns {Promise<boolean>} True if the connector is available, false otherwise.
 */
export async function checkConnectorAvailability(serialNumber, connectorId) {
  // These are the states from the OCPP specification that indicate readiness
  // or ability to accept a new transaction request. 'Preparing' is often included
  // because a remote start might be sent while the EV is already plugged in
  // (Status: Preparing).
  const ALLOWED_STATUSES = ["Available", "Preparing", "Reserved"];

  const connectorCheckQuery = {
    // Condition 1: Match the specific Charge Point instance
    serialNumber: serialNumber,

    // Condition 2: Check conditions within the 'connectors' array using $elemMatch
    connectors: {
      $elemMatch: {
        // a. Match the specific connector ID
        connectorId: connectorId,

        // b. Connector must be in a ready or reserved state
        status: { $in: ALLOWED_STATUSES },

        // c. Must NOT have an active transaction running on it.
        // Assuming 'currentTransactionId' is null or 0 when free.
        currentTransactionId: { $in: [0, null] },
      },
    },
  };

  try {
    // Use select('_id') and limit(1) for maximum performance, as we only need to
    // confirm existence, not retrieve the full document.
    const cpDocument = await chargePoint.findOne(connectorCheckQuery);
    // console.log(cpDocument)

    // If the document is found, it means all conditions were met.
    return !!cpDocument;
  } catch (error) {
    console.error("Database error during connector check:", error);
    // Fail safe: assume not available if database call fails
    return false;
  }
}

/**
 * Generic function to find a document in any Mongoose Model
 * by a specific numeric ID field (e.g., transactionId, reservationId).
 *
 * @param {mongoose.Model} Model - The Mongoose model (e.g., Transaction, Reservation).
 * @param {string} keyName - The name of the numeric field to query (e.g., 'transactionId').
 * @param {number} keyValue - The numeric value to match against.
 * @returns {Promise<mongoose.Document|null>} The found document or null.
 */
export async function findDocById(Model, queryFilter) {
  if (!Model || !queryFilter) {
    console.error(
      "Invalid arguments provided to findDocByNumericId. Check Model, queryFilter"
    );
    return null;
  }
  console.log("queryFilter", queryFilter, Model);

  try {
    const document = await Model.findOne(queryFilter).exec();
    const { _id, isFinished } = document;
    if (!_id) {
      console.log(`Document not found: ${_id}`);
      return null;
    }

    console.log(`Found document. isFinished: ${isFinished}`);
    return document;
  } catch (error) {
    console.error(
      `Database error during lookup for  ${queryFilter}:`,
      error.message
    );
    // Throwing the error is usually better for async functions
    throw new Error(`Failed to query database: ${error.message}`);
  }
}

export async function updateConnectorStatus(serialNumber, status, connectorId) {
  try {
    console.log(serialNumber, status, connectorId);
    const updatedCP = await chargePoint.findOneAndUpdate(
      {
        serialNumber,
        "connectors.connectorId": connectorId,
      },
      {
        $set: {
          "connectors.$.status": status,
        },
      },
      {
        new: true,
      }
    );
    // console.log("updatedCP", updatedCP);

    if (!updatedCP) {
      console.log(
        `Charge Point ${serialNumber} or Connector ${connectorId} not found.`
      );
      // logger.error(
      //   `Charge Point ${serialNumber} or Connector ${connectorId} not found.`
      // );
      return false;
    }
    console.log(
      `Status updated for Connector ${connectorId} on ${serialNumber} to status: ${status}.`
    );
    return true;
  } catch (error) {
    console.error("Error updating connector status:", error);
    // logger.error(`Error updating connector status: ${error}`);
    return false;
  }
}

/**
 * function to update the change configuration by validating the status of the configuration
 * by a specific numeric ID field (e.g., transactionId, reservationId).
 *
 * @param {boolean} isValid - The payload checks.
 * @param {string} payload - The payload.
 * @param {string} chargePointId - The connected chargePointId.
 * @param {value} keyValue - The numeric value to  against.
 * @returns {Promise<mongoose.Document|null>} The found document or null.
 */
export async function changeConfigUpdate(
  isValid,
  payload,
  chargePointId,
  value,
  key
) {
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
}

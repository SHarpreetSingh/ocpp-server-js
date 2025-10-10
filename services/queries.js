//services/queries.js
import chargePoint from "../models/chargePoint.js";


export async function createAndUpdateBootnotification(payload, ocppHandler) {

    const update = {
        vendor: payload.chargePointVendor,
        model: payload.chargePointModel,
        serialNumber : ocppHandler.chargePointId,
        firmwareVersion: payload.firmwareVersion,
        lastBoot: new Date(),
        status: "Accepted",
        heartbeatInterval: 300,
        connectors :payload.connectors,
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

        console.log(createAndUpdtCP)
        if (!createAndUpdtCP) {
            console.log(`Charge Point ${ocppHandler.chargePointId} or  not found.`);
            return ocppHandler.sendError(messageId, {
                status: "Rejected",
                currentTime: new Date().toISOString(),
                interval: 0,
            });
        }
        console.log(`created or updated  serialNumber:${ocppHandler.chargePointId}`);
        return true
    } catch (error) {
        console.error("Error updating connector status:", error);
        return ocppHandler.sendError(messageId, {
            status: "Rejected",
            currentTime: new Date().toISOString(),
            interval: 0,
        });
    }
}

export async function updateConnectorStatus(serialNumber, status, connectorId) {
    try {
        console.log(serialNumber, status, connectorId)
        const updatedCP = await chargePoint.findOneAndUpdate(
            {
                serialNumber,
                'connectors.connectorId': connectorId
            },
            {
                $set: {
                    'connectors.$.status': status,
                }
            },
            {
                new: true,
            }
        );
        // console.log("updatedCP", updatedCP)

        if (!updatedCP) {
            console.log(`Charge Point ${serialNumber} or Connector ${connectorId} not found.`);
            return false
        }
        console.log(`Status updated for Connector ${connectorId} on ${serialNumber} to status: ${status}.`);
        return true
    } catch (error) {
        console.error("Error updating connector status:", error);
        return false
    }
}
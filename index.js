import WebSocket, { WebSocketServer } from "ws";
import mongoose from "mongoose";
import http from "http";
import express from "express";
const app = express();
const server = http.createServer(app);
import { OcppHandler } from "./ocppHandler.js";
import logger from "./logger.js";
import bodyParser from "body-parser";
import {
  checkConnectorAvailability,
  findDocById
} from "./services/queries.js";
import transaction from "./models/transaction.js";


app.use(bodyParser.json());

const connectedChargePoints = new Map();

const apiLoggerMiddleware = (req, res, next) => {
  // Determine the client IP address, accounting for proxies
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  const logEntry = `[API LOG] - ${new Date().toISOString()}
  Source IP: ${clientIp}
  Method: ${req.method}
  Path: ${req.originalUrl}
  Body Keys: ${Object.keys(req.body).join(', ') || 'None'}
--------------------------------------------------`;

  console.log(logEntry);
  // **Crucial Step:** Call next() to allow the request to proceed to the route handlers.
  next();
};

app.use(apiLoggerMiddleware);

try {
  (async function () {
    try {
      await mongoose.connect("mongodb://localhost:27017/ocpp");
      logger.info("MongoDB connected successfully");
    } catch (error) {
      console.error(
        `Error connecting to MongoDB: ${error.message}\n${error.stack}`
      );
    }
  })();

  const wss = new WebSocketServer({
    server,
  });

  wss.on("connection", async (socket, req) => {
    const urlParts = req.url.split("/");

    const CpID = urlParts[urlParts.length - 1];

    if (!CpID || CpID.length === 0) {
      console.error(
        `Rejected connection: Missing Charge Point ID in URL: ${req.url}`
      );
      // In the context of a WSS server, the standard response for this error
      // is to immediately terminate the connection.
      socket.terminate();
      return;
    }

    console.log(`CP connected: ${CpID}`);
    logger.info(`CP connected: ${CpID}`);
    socket.on("message", (message) => {
      // console.log(`Message receviced from ${CpID}: ${message}`);
      logger.info(`<- Request from CP ${CpID}: ${message}`);
    });

    // Pass the WebSocket and ID to the OCPP handler
    const ocppHandler = new OcppHandler(socket, CpID);
    connectedChargePoints.set(CpID, ocppHandler);
    // console.log("connectedChargePoints", connectedChargePoints);

    socket.on("message", ocppHandler.onMessage.bind(ocppHandler));

    // if (socket && socket.readyState === socket.OPEN) {
    // await new Promise((resolve) => {
    socket.on("close", (message) => {
      socket.close();
      // resolve()
      console.debug(`closed connection from ${CpID} `);
      logger.info(`closed connection from ${CpID} `);
    });
    // })
    // }
  });

  const PORT = 3000;
  server.listen(PORT, () => {
    console.log(`🚀 HTTP API:   http://localhost:${PORT}`);
    console.log(`🚀 WebSocket: ws://localhost:${PORT}`);
  });

  app.post("/adminApi/chargers/change-availability/:cpId", async (req, res) => {
    const serialNumber = req.params.cpId;

    const { type, connectorId } = req.body;
    console.log("hit api", req.params, "req.body", req.body);

    const handlerInstance = connectedChargePoints.get(serialNumber);
    console.log("handlerInstance", handlerInstance);

    if (
      !type ||
      !["Operative", "Inoperative"].includes(type) ||
      connectorId === undefined
    ) {
      return res.status(400).json({
        message:
          '❌ Invalid request body. "status" must be "Operative" or "Inoperative", and "connectorId" is required.',
      });
    }

    if (!handlerInstance) {
      return res
        .status(404)
        .json({ message: "❌ Charge point not found or not connected." });
    }

    try {
      const result = await handlerInstance.changeAvailability(
        serialNumber,
        type,
        connectorId
      );
      res.status(200).json({ status: "Accepted", connectorId });
    } catch (error) {
      res.status(500).json({
        status: "Rejected",
        message: "❌ Failed to send ChangeAvailability command.",
        error: error.message,
      });
    }
  });

  app.post('/adminApi/chargepoints/:serialNumber/remotestart', async (req, res) => {
    const serialNumber = req.params?.serialNumber;
    if (!serialNumber) return res.status(400).json({ error: "serialNumber is required for remote start." });

    const { idTag, connectorId } = req.body;

    // 1. Basic Validation (Check required fields)
    if (!idTag)
      return res.status(400).json({ error: "idTag is required for remote start." });

    try {
      // --- 2. Central System Pre-Checks (Database) ---
      // You would run the connectorCheckQuery and idTagCheckQuery here first
      // to avoid sending the command if failure is certain.
      // const isIdTagActive = await checkIdTagStatus(idTag);
      // If (!isIdTagActive) return res.status(403).json({ error: "Authorization rejected: ID Tag is inactive or expired." });

      const isConnectorAvailable = await checkConnectorAvailability(serialNumber, connectorId);
      // console.log(isConnectorAvailable)

      if (!isConnectorAvailable)
        return res.status(409).json({ error: "Connector is already busy or faulted." });

      const ocppPayload = {
        idTag,
        connectorId, // Optional, but included if sent by API client
      };

      // NOTE: 'ocppClient.sendRemoteStart' handles finding the CP's active WebSocket
      // and sends the [2, messageId, "RemoteStartTransaction", {payload}] message.
      const handlerInstance = connectedChargePoints.get(serialNumber);
      const { status } = await handlerInstance.sendRemoteStart(serialNumber, ocppPayload);
      // console.log("status", status)

      // // --- 4. Handle Confirmation from CP (The RemoteStartTransaction.conf) ---
      if (status !== 'Accepted') {
        // Command was accepted by the CP. 
        // The actual transaction status will be reported later via StartTransaction.req.
        // CP rejected the command (e.g., connector unavailable, invalid request).
        return res.status(409).json({ // 409 Conflict is often used for this
          status,
          message: 'Charge Point rejected the remote start command.',
          cpResponse: status
        });
      }

      return res.status(200).json({
        status,
        message: 'Remote start command successfully sent and accepted by Charge Point.'
      });

    } catch (error) {
      // CP not connected, or database error
      console.error(`Error processing remote start for ${serialNumber}:`, error);
      return res.status(500).json({ error: `Failed to communicate with Charge Point or command timed out.` });
    }
  });

  app.post('/adminApi/chargepoints/:serialNumber/remotestop', async (req, res) => {
    const serialNumber = req.params.serialNumber;
    if (!serialNumber) return res.status(400).json({ error: "serialNumber is required for remote stop." });

    // The key payload element for RemoteStopTransaction is the transactionId
    const { csTransactionId } = req.body;
    console.log(`transactionId: ${csTransactionId}`);


    // 1. Basic Validation (Check required fields)
    if (!csTransactionId || isNaN(csTransactionId))
      return res.status(400).json({ error: "A valid integer transactionId is required for remote stop." });

    const ocppPayload = {
      csTransactionId,
    };
    console.log(`ocppPayload: ${JSON.stringify(ocppPayload)}`);

    try {
      // Check if the transaction is still active in the CSMS database.
      const { isFinished } = await findDocById(transaction, (ocppPayload));
      // console.log("findDocById", status)

      if (isFinished) {
        // This prevents the CSMS from sending a command that is likely to be rejected.
        return res.status(409).json({
          error:
            `Transaction ${csTransactionId} is already ${isFinished} and cannot be remotely stopped.`
        });
      }

      // 3. Find Handler and Send Command
      const handlerInstance = connectedChargePoints.get(serialNumber);
      if (!handlerInstance) {
        return res.status(404).json({ error: `Charge Point ${serialNumber} is not currently connected.` });
      }

      // Send the RemoteStopTransaction.req and await the .conf response
      const { status } = await handlerInstance.sendRemoteStop(serialNumber, ocppPayload);
      console.log("RemoteStopTransaction.conf received: status", status);

      // // --- 4. Handle Confirmation from CP (The RemoteStopTransaction.conf) ---
      if (status !== 'Accepted') {
        // CP rejected the command (e.g., ID not found, CP error).
        return res.status(409).json({
          status: 'Rejected',
          message: 'Charge Point rejected the remote stop command.',
          cpResponse: status
        });
      }

      // Command accepted by the CP. The actual transaction status change (StopTransaction.req) 
      // will be reported later by the CP.
      return res.status(202).json({
        status,
        message: `Remote stop command successfully sent and
         accepted by Charge Point for JSON.stringify(ocppPayload).`
      });

    } catch (error) {
      // Catch exceptions like command timeout, network failure, or unexpected DB errors.
      console.error(`Error processing remote stop for ${serialNumber} (ID):`, error);
      return res.status(500).json({ error: `Failed to communicate with Charge Point or command timed out.` });
    }
  });

  app.post(
    "/adminApi/chargers/change-configuration/:cpId",
    async (req, res) => {
      const chargePointId = req.params.cpId;
      const { key, value } = req.body;

      console.log("API hit:", req.params, "req.body:", req.body);

      const handlerInstance = connectedChargePoints.get(chargePointId);
      if (!handlerInstance) {
        return res
          .status(404)
          .json({ message: "❌ Charge point not connected." });
      }

      if (!key || !value) {
        return res.status(400).json({
          message:
            '❌ Invalid request body. Both "key" and "value" are required.',
        });
      }

      try {
        const result = await handlerInstance.handleChangeConfiguration(
          chargePointId,
          key,
          value
        );
        res.status(200).json({
          message: "✅ ChangeConfiguration request sent successfully.",
          response: result,
        });
      } catch (error) {
        res.status(500).json({
          message: "❌ Failed to send ChangeConfiguration request.",
          error: error.message,
        });
      }
    }
  );

  app.post("/adminApi/chargers/get-configuration/:cpId", async (req, res) => {
    const chargePointId = req.params.cpId;
    const key = req.body || "";

    console.log("API hit:", req.params, "req.body:", req.body);

    const handlerInstance = connectedChargePoints.get(chargePointId);
    if (!handlerInstance) {
      return res
        .status(404)
        .json({ message: "❌ Charge point not connected." });
    }

    try {
      const result = await handlerInstance.handleGetConfiguration(key);
      res.status(200).json({
        message: "✅ GetConfiguration request sent successfully.",
        response: result,
      });
    } catch (error) {
      res.status(500).json({
        message: "❌ Failed to send ChangeConfiguration request.",
        error: error.message,
      });
    }
  });

} catch (err) {
  console.log("err", err);
}

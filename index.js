import WebSocket, { WebSocketServer } from "ws";
import mongoose from "mongoose";
import http from "http";
import express from "express";
const app = express();
const server = http.createServer(app);
import { OcppHandler } from "./ocppHandler.js";
import logger from "./logger.js";
import bodyParser from "body-parser";
import { checkConnectorAvailability, findDocById } from "./services/queries.js";
import transaction from "./models/transaction.js";
import cors from "cors";
import chargePoint from "./models/chargePoint.js";
app.use(bodyParser.json());
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, 'uploaded_diagnostics');

const connectedChargePoints = new Map();

// ✅ Allow frontend (React) to call backend (CSMS)
app.use(
  cors({
    origin: "http://localhost:5173", // React dev server
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

// Ensure the upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
  console.log(`Created upload directory: ${uploadDir}`);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      // Use the dedicated directory for storing diagnostics files
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      // Use the original filename provided by the CP (e.g., CP-MANUAL-003-logs.zip)
      // Sanitizing the filename might be needed in a production environment
      cb(null, file.originalname);
    }
  });

  const upload = multer({
    storage: storage,
    limits: { fileSize: 1 * 1024 * 1024 } // 10MB file size limit for example
  }).single('diagnostics');

// const apiLoggerMiddleware = (req, res, next) => {
//   // Determine the client IP address, accounting for proxies
//   const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

//   const logEntry = `[API LOG] - ${new Date().toISOString()}
//   Source IP: ${clientIp}
//   Method: ${req.method}
//   Path: ${req.originalUrl}
//   Body Keys: ${Object.keys(req.body).join(", ") || "None"}
// --------------------------------------------------`;

//   console.log(logEntry);
//   // **Crucial Step:** Call next() to allow the request to proceed to the route handlers.
//   next();
// };

const apiLoggerMiddleware = (req, res, next) => {
  // Determine the client IP address, accounting for proxies
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  // ✅ Safely handle empty or undefined body
  const body = req.body && typeof req.body === "object" ? req.body : {};

  const logEntry = `[API LOG] - ${new Date().toISOString()}
  Source IP: ${clientIp}
  Method: ${req.method}
  Path: ${req.originalUrl}
  Body Keys: ${Object.keys(body).length > 0 ? Object.keys(body).join(", ") : "None"}
--------------------------------------------------`;

  console.log(logEntry);
  next(); // Crucial: continue to next middleware/route
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
      console.log(`Message receviced from ${CpID}: ${message}`);
      // logger.info(`<- Request from CP ${CpID}: ${message}`);
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

  app.post(
    "/adminApi/chargers/:cpId/change-availability/",
    async (req, res) => {
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
    }
  );

  app.post("/adminApi/chargers/:cpId/remotestart", async (req, res) => {
    const serialNumber = req.params?.cpId;
    if (!serialNumber)
      return res
        .status(400)
        .json({ error: "serialNumber is required for remote start." });

    const { idTag, connectorId } = req.body;
    // 1. Basic Validation (Check required fields)
    if (!idTag)
      return res
        .status(400)
        .json({ error: "idTag is required for remote start." });
    // console.log("Payload:=>>>>>>>", idTag, connectorId);

    try {
      // --- 2. Central System Pre-Checks (Database) ---
      // You would run the connectorCheckQuery and idTagCheckQuery here first
      // to avoid sending the command if failure is certain.
      // const isIdTagActive = await checkIdTagStatus(idTag);
      // If (!isIdTagActive) return res.status(403).json({ error: "Authorization rejected: ID Tag is inactive or expired." });

      const isConnectorAvailable = await checkConnectorAvailability(
        serialNumber,
        connectorId
      );
      // console.log("isConnectorAvailable", isConnectorAvailable);

      if (!isConnectorAvailable)
        return res
          .status(409)
          .json({ error: "Connector is already busy or faulted." });

      const ocppPayload = {
        idTag,
        connectorId, // Optional, but included if sent by API client
      };

      // NOTE: 'ocppClient.sendRemoteStart' handles finding the CP's active WebSocket
      // and sends the [2, messageId, "RemoteStartTransaction", {payload}] message.
      const handlerInstance = connectedChargePoints.get(serialNumber);
      if (!handlerInstance) {
        return res.status(404).json({
          error: `Charge Point ${serialNumber} is not currently connected.`,
        });
      }
      const { status } = await handlerInstance.sendRemoteStart(
        serialNumber,
        ocppPayload
      );
      console.log("status", status);

      // // --- 4. Handle Confirmation from CP (The RemoteStartTransaction.conf) ---
      if (status !== "Accepted") {
        // Command was accepted by the CP.
        // The actual transaction status will be reported later via StartTransaction.req.
        // CP rejected the command (e.g., connector unavailable, invalid request).
        return res.status(409).json({
          // 409 Conflict is often used for this
          status,
          message: "Charge Point rejected the remote start command.",
          cpResponse: status,
        });
      }

      return res.status(200).json({
        status,
        message:
          "Remote start command successfully sent and accepted by Charge Point.",
      });
    } catch (error) {
      // CP not connected, or database error
      console.error(
        `Error processing remote start for ${serialNumber}:`,
        error
      );
      return res.status(500).json({
        error: `Failed to communicate with Charge Point or command timed out.`,
      });
    }
  });

  app.post("/adminApi/chargers/:cpId/remotestop", async (req, res) => {
    const serialNumber = req.params.cpId;
    if (!serialNumber)
      return res
        .status(400)
        .json({ error: "serialNumber is required for remote stop." });

    // The key payload element for RemoteStopTransaction is the transactionId
    const { csTransactionId } = req.body;
    console.log(`transactionId: ${csTransactionId}`);

    // 1. Basic Validation (Check required fields)
    if (!csTransactionId || isNaN(csTransactionId))
      return res.status(400).json({
        error: "A valid integer transactionId is required for remote stop.",
      });

    const ocppPayload = {
      csTransactionId,
    };
    console.log(`ocppPayload: ${JSON.stringify(ocppPayload)}`);

    try {
      // Check if the transaction is still active in the CSMS database.
      const { isFinished } = await findDocById(transaction, ocppPayload);
      // console.log("findDocById", status)

      if (isFinished) {
        // This prevents the CSMS from sending a command that is likely to be rejected.
        return res.status(409).json({
          error: `Transaction ${csTransactionId} is already ${isFinished} and cannot be remotely stopped.`,
        });
      }

      // 3. Find Handler and Send Command
      const handlerInstance = connectedChargePoints.get(serialNumber);
      if (!handlerInstance) {
        return res.status(404).json({
          error: `Charge Point ${serialNumber} is not currently connected.`,
        });
      }

      // Send the RemoteStopTransaction.req and await the .conf response
      const { status } = await handlerInstance.sendRemoteStop(
        serialNumber,
        ocppPayload
      );
      console.log("RemoteStopTransaction.conf received: status", status);

      // // --- 4. Handle Confirmation from CP (The RemoteStopTransaction.conf) ---
      if (status !== "Accepted") {
        // CP rejected the command (e.g., ID not found, CP error).
        return res.status(409).json({
          status: "Rejected",
          message: "Charge Point rejected the remote stop command.",
          cpResponse: status,
        });
      }

      // Command accepted by the CP. The actual transaction status change (StopTransaction.req)
      // will be reported later by the CP.
      return res.status(202).json({
        status,
        message: `Remote stop command successfully sent and
         accepted by Charge Point for JSON.stringify(ocppPayload).`,
      });
    } catch (error) {
      // Catch exceptions like command timeout, network failure, or unexpected DB errors.
      console.error(
        `Error processing remote stop for ${serialNumber} (ID):`,
        error
      );
      return res.status(500).json({
        error: `Failed to communicate with Charge Point or command timed out.`,
      });
    }
  });

  app.post("/adminApi/chargers/:cpId/changeconfiguration", async (req, res) => {
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
  });

  app.post("/adminApi/chargers/:cpId/getconfiguration", async (req, res) => {
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

  app.post("/adminApi/chargers/:cpId/send-local-list", async (req, res) => {
    const cpId = req.params.cpId;
    const listVersion = req.body.listVersion || Date.now();

    const handler = connectedChargePoints.get(cpId);
    if (!handler) {
      return res.status(404).json({ msg: "❌ CP not connected" });
    }

    try {
      const result = await handler.sendLocalList(listVersion);
      res.json({
        message: "📤 SendLocalList sent to CP successfully",
        result,
      });
    } catch (err) {
      res.status(500).json({
        error: "❌ Failed to send SendLocalList",
        details: err.message,
      });
    }
  });

  app.get("/adminApi/config/:cpId", async (req, res) => {
    const cpId = req.params.cpId;

    try {
      // 💡 Step 1: Query your database to find the CP
      const cpRecord = await findDocById(chargePoint, { serialNumber: cpId });
      // const cpRecord = await db.collection('chargepoints').findOne({ cpId: cpId });

      if (!cpRecord) {
        // Fallback if the CP isn't in the database
        return res.status(404).send({ message: "Charge Point not found" });
      }

      // ✅ If no connectors exist, auto-create them
      if (!cpRecord.connectors || cpRecord.connectors.length === 0) {
        const defaultConnectors = [
          { connectorId: 1, status: "Available", currentTransactionId: null },
          { connectorId: 2, status: "Available", currentTransactionId: null },
        ];

        cpRecord = await chargePoint.findOneAndUpdate(
          { serialNumber: cpId },
          { $set: { connectors: defaultConnectors } },
          { new: true }
        );

        console.log(`✨ Initialized default connectors for ${cpId}`);
      }
      // 💡 Step 2: Extract or determine the connector count
      // You must store this value somewhere in your CP database schema!
      const connectorCount = cpRecord.connectors.length; // Assuming your DB stores an array of connector objects
      // OR: const connectorCount = cpRecord.connectorCount || 1;

      // 💡 Step 3: Send the required data back to the frontend
      res.json({
        cpId: cpId,
        connectorCount: connectorCount,
        connectors: cpRecord.connectors,
        // Optional: Include other initial settings here (e.g., heartbeatInterval)
      });
    } catch (error) {
      res.status(500).json({
        message: "❌ Failed to send config request.",
        error: error.message,
      });
    }
  });

  // 
  app.post("/adminApi/chargers/:cpId/getDiagnostics", async (req, res) => {
    const serialNumber = req.params.cpId;
    if (!serialNumber)
      return res
        .status(400)
        .json({ error: "serialNumber is required for remote stop." });

    const { location, startTime, stopTime } = req.body;

    // 1. Basic Input Validation
    if (!location || typeof location !== 'string' || !location.startsWith('ftp') && !location.startsWith('http')) {
      return res
        .status(400)
        .json({
          message: "❌ Invalid request. 'location' (a valid FTP/HTTP URL) is required."
        });
    }

    // 2. Locate the Handler Instance
    const handlerInstance = connectedChargePoints.get(serialNumber);
    if (!handlerInstance) {
      return res
        .status(404)
        .json({
          message: `❌ Charge point ${serialNumber} is not connected.`
        });
    }

    const ocppPayload = {
      location, startTime, stopTime
    };

    try {
      // 3. Send the GetDiagnostics.req command via the OcppHandler instance.
      const result = await handlerInstance.getDiagnostics(
        serialNumber,
        ocppPayload
      );

      res.status(200).json({
        message: `Diagnostics request accepted. CP will upload logs as: ${result}`,
        result,
        // cpResponse: result,
      });

    } catch (error) {
      console.error(`Error initiating GetDiagnostics for ${serialNumber}:`, error.message);
      let statusCode = 500;
      if (error.message.includes("Validation failed")) {
        statusCode = 400;
      }
      res.status(statusCode).json({
        message: `❌ Failed to send GetDiagnostics command.`,
        error: error.message,
      });
    }
  });

  // 
  app.post("/adminApi/chargers/:cpId/update-firmware", async (req, res) => {
    const serialNumber = req.params.cpId;
    if (!serialNumber)
      return res
        .status(400)
        .json({ error: "serialNumber is required for remote stop." });

    const { location, retrieveDate } = req.body;

    // 1. Basic Input Validation (Location and ISO 8601 Timestamp)
    if (!location || !retrieveDate || typeof location !== 'string' || typeof retrieveDate !== 'string') {
      return res
        .status(400)
        .json({
          message: "❌ Invalid request. 'location' (firmware URL) and 'retrieveDate' (ISO 8601 time) are required."
        });
    }

    // 2. Locate the Handler Instance
    const handlerInstance = connectedChargePoints.get(serialNumber);
    if (!handlerInstance) {
      return res
        .status(404)
        .json({
          message: `❌ Charge point ${serialNumber} is not connected.`
        });
    }

    try {
      // 3. (waits for immediate acknowledgement)
      const result = await handlerInstance.updateFirmware(
        serialNumber,
        req.body
      );

      console.debug("updateFirmwareCommand", result)
      // Check if the result is an object and if it is empty


      // 4. Confirmation Payload is empty {}, so success means acceptance.
      res.status(200).json({
        message: `Firmware update scheduled for ${retrieveDate}. CP acknowledged the command.`,
        cpResponsed: result, // Will be {} if successful
      });
    } catch (error) {
      console.error(`Error initiating UpdateFirmware for ${serialNumber}:`, error);
      res.status(500).json({
        message: `Failed to send UpdateFirmware command or command timed out.`,
        error: error.message,
      });
    }
  });


  app.post('/adminApi/upload/logs', (req, res) => {
    upload(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        console.error("Multer Error:", err.message);
        // Example: Handle file size limit error
        return res.status(400).send({ message: `Upload failed: ${err.message}` });
      } else if (err) {
        console.error("Unknown Upload Error:", err);
        return res.status(500).send({ message: 'Internal server error during upload.' });
      }

      // Check if a file was actually uploaded
      if (!req.file) {
        return res.status(400).send({ message: 'No file uploaded. Expected field name: diagnostics.' });
      }

      console.log(`[SUCCESS] File uploaded: ${req.file.originalname}`);
      console.log(`[PATH] Saved to: ${req.file.path}`);

      // Send a successful response back to the CP simulator (HTTP client)
      // The CP will interpret a 200/201 status as a successful transfer.
      res.status(200).json({
        message: 'Diagnostics file received successfully.',
        filename: req.file.originalname
      });
    });
  });

} catch (err) {
  console.log("err", err);
}

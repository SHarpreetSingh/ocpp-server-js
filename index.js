import WebSocket, { WebSocketServer } from "ws";
import mongoose from "mongoose";
import http from "http";
import express from "express";
const app = express();
const server = http.createServer(app);
import { OcppHandler } from "./ocppHandler.js";
import logger from "./logger.js";
import bodyParser from "body-parser";

app.use(bodyParser.json());

const connectedChargePoints = new Map();

try {
  (async function () {
    try {
      await mongoose.connect("mongodb://localhost:27017/ocpp");
      console.log("MongoDB connected successfully");
    } catch (error) {
      console.error(
        `Error connecting to MongoDB: ${error.message}\n${error.stack}`
      );
    }
  })();

  const wss = new WebSocketServer({
    server,
    // port: 9290,
    // path: "/ocpp",
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
      logger.info(`<- Request from CP ${CpID}: ${message}`);
    });

    // Pass the WebSocket and ID to the OCPP handler
    const ocppHandler = new OcppHandler(socket, CpID);
    connectedChargePoints.set(CpID, ocppHandler);
    // console.log("connectedChargePoints", connectedChargePoints)

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
    console.log(`🚀 HTTP API:   http://localhost:${PORT}/api/test`);
    console.log(`🚀 WebSocket: ws://localhost:${PORT}`);
  });

  app.post("/adminApi/chargers/change-availability/:cpId", async (req, res) => {
    const serialNumber = req.params.cpId;

    const { type, connectorId } = req.body;
    console.log("hit api", req.params, "req.body", req.body);

    const handlerInstance = connectedChargePoints.get(serialNumber);
    // console.log("handlerInstance", handlerInstance);

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
} catch (err) {
  console.log("err", err);
}

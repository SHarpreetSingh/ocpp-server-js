import WebSocket, { WebSocketServer } from "ws";
import mongoose from "mongoose";
import http from "http";
import express from "express";
const app = express();
const server = http.createServer(app);
// const OcppHandler = require('./ocppHandler.js');
import { OcppHandler } from "./ocppHandler.js";

try {
  (async function () {
    try {
      await mongoose.connect("mongodb://localhost:27017/ocpp");
      console.log("MongoDB connected successfully");
    } catch (error) {
      console.log(error);
    }
  })();

  const wss = new WebSocketServer({
    server,
    // port: 9290,
    // path: "/ocpp",
  });

  wss.on("connection", (socket, req) => {
    const urlParts = req.url.split("/");
    console.log("first")

    const CpID = urlParts[urlParts.length - 1] || "unknown";
    console.log(`CP connected: ${CpID}`);

    socket.on("message", (message) => {
      console.log(`Message receviced from ${CpID}: ${message}`);
    });

    // Pass the WebSocket and ID to the OCPP handler
    const ocppHandler = new OcppHandler(socket, CpID);

    socket.on('message', ocppHandler.onMessage.bind(ocppHandler));

    socket.on("close", (message) => {
      console.log(`closed connection from ${CpID} `);
    });
  });

  const PORT = 3000;
  server.listen(PORT, () => {
    console.log(`🚀 HTTP API:   http://localhost:${PORT}/api/test`);
    console.log(`🚀 WebSocket: ws://localhost:${PORT}`);
  });
} catch (err) {
  console.log(err);
}

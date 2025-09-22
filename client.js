import WebSocket from "ws";

try {
  const ws = new WebSocket("ws://localhost:3000/ws");

  ws.on("open", () => {
    console.log("Connected to CSMS ✅");
    ws.send("BootNotification.req");
  });

  ws.on("message", (msg) => {
    console.log("Received:", msg.toString());
  });
} catch (err) {
  console.log(err);
}

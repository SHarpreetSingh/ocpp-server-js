import WebSocket from "ws";

try {
  const ws = new WebSocket("ws://localhost:3000/cp1");
  let uniqueId = Date.now().toString();
const message = Buffer.from('["2","12345","BootNotification",{"chargePointModel":"modelA","chargePointVendor":"vendorB"}]');

  
  console.log("message cli",message)

  ws.on("open", () => {
    console.log("Connected to CSMS ✅");
    ws.send(message);
  });

  ws.on("message", (msg) => {
    console.log("Received:", msg.toString());
  });
} catch (err) {
  console.log(err);
}

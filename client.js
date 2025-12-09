import WebSocket from "ws";

try {
  const ws = new WebSocket("ws://localhost:3000/CP_MANUAL_003");
  let uniqueId = new Date().toISOString();


  // const message = Buffer.from('[2,"12345","BootNotification",{"chargePointModel":"modelHSI","chargePointVendor":"vendorB"}]');

  // const message = Buffer.from('[2,"12345","StartTransaction",{"connectorId": 1,  "idTag": "ABC123",  "timestamp": "2025-10-08T10:00:00Z",  "meterStart": 0}]');

  const message = Buffer.from(`[2,"12345","MeterValues",{"connectorId": 1,"transactionId": 517, "meterValue": [{ "timestamp":"${uniqueId}", "sampledValues": [{ "value": "1319" }] }]}]`)

  // `[2,"12345","StatusNotification",{"connectorId":2,"status":"Unavailable","errorCode":"NoError","timestamp":"${uniqueId}"}]`; //Available, Unavailable

  const jsonString = `[3,"12345","GetDiagnostics",{"fileName":"CP42-Logs-20251208.zip"}]`;

  // const message = Buffer.from('[2,"12345","StatusNotification",{"connectorId":"1","status":"Preparing","errorCode":"NO ERROR"]');
  // const message = Buffer.from(jsonString);

  console.log("message cli", message)

  ws.on("open", () => {
    console.log("Connected to CSMS ✅");
  });

  ws.on("message", (rawMessage) => {
    let msg = JSON.parse(rawMessage);
    console.log("Received:", msg);
   
    const responseArray = Buffer.from(`[3,"${msg[1]}",{"fileName":"CP42-Logs-20251208.zip"}]`)
    console.log("Received:", responseArray);
    ws.send(responseArray);
  });
} catch (err) {
  console.log(err);
}


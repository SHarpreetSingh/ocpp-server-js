## 🚗 OCPP 1.6 Server and compliance testing framework
This project provides a Node.js-based test automation framework for verifying OCPP 1.6 compliance of Charge Points (CPs). The framework simulates a Central System (CS) to interact with real or virtual Charge Points over WebSocket, allowing testers to validate that the Charge Point adheres strictly to the OCPP 1.6 JSON specification.

## Key Objectives:

OCPP Compliance Testing: Ensure that a Charge Point implements all mandatory OCPP 1.6 actions correctly, responds with the appropriate CallResult messages, and handles errors according to the specification.
Automation Ready: Provides reusable test scripts that can automate verification of common OCPP flows such as BootNotification, Authorize, StartTransaction, StopTransaction, Heartbeat, StatusNotification, and MeterValues.
UUID Management: Automatically generates unique request IDs (UniqueId) for every interaction and verifies responses against these IDs.
WebSocket Connection Handling: Maintains persistent, bi-directional connections with Charge Points, simulating real-world OCPP communication scenarios.
Error and Exception Handling: Validates that the Charge Point handles unexpected scenarios gracefully, including invalid requests, rejected authorization, or missing payload fields.
Database Integration (MongoDB): Stores Charge Point configurations, IdTags, and session history to verify correct data handling and persistence.
Extensible Architecture: Built with modular Node.js components for easy addition of new test cases, scenarios, or OCPP actions.
Reporting & Logging: Captures detailed logs for each interaction, including message payloads, timestamps, and validation results, to aid debugging and compliance audits.

## Framework Components:

Central System Simulator (Server) – Node.js server that acts as the OCPP backend.

Charge Point Simulator / Real CP Interface (Client) – Connects via WebSocket to test real or simulated Charge Points.

Message Handlers – Modular functions for processing incoming messages and generating appropriate responses.

Test Case Library – Scripts that automate standard OCPP scenarios for compliance testing.

MongoDB Database – Stores Charge Point information, transaction logs, and test results.

Logger & Reporter – Maintains traceable logs and summaries of test runs for auditing.

## Example Use Cases:

1.Verify that a Charge Point sends BootNotification correctly and handles CallResult responses.
2.Test authorization flows using stored IdTags in MongoDB.
3.Validate remote operations like RemoteStartTransaction and RemoteStopTransaction.
4.Ensure compliance with mandatory OCPP 1.6 message types and error handling.
5.Automate periodic Heartbeat and StatusNotification tests to confirm persistent connection behavior.

##📋 Table of Contents

1.Prerequisites
	Install Node.js & npm
	Install MongoDB
2.OCPP 1.6 Message format
3.Transport & WebSocket Connection
4.OCPP JSON Message Format
5.Common OCPP Actions
6.Basic Components in an OCPP Project
7.Good Practices
8.Useful Links

## Prerequisites

Before setting up the OCPP server, make sure you have Node.js, npm, and MongoDB installed.

1️⃣ Install Node.js and npm
📝 Note: Installing Node.js automatically installs npm.

Step A: Update your system
sudo apt update
sudo apt upgrade -y

Step B: Install Node.js via NodeSource (recommended for latest LTS)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

Step C: Verify installation
node -v   # Shows Node.js version
npm -v    # Shows npm version

Alternative: Install via nvm (Node Version Manager)
nvm allows you to install and switch between multiple Node.js versions easily.
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.6/install.sh | bash
source ~/.bashrc
nvm install --lts
nvm use --lts
node -v
npm -v

2️⃣ Install MongoDB

Step A: Import MongoDB public key and create repo
wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-archive-keyring.gpg
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-archive-keyring.gpg ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

Step B: Update and install MongoDB
sudo apt update
sudo apt install -y mongodb-org

Step C: Start MongoDB service
sudo systemctl start mongod
sudo systemctl enable mongod
sudo systemctl status mongod

Step D: Verify MongoDB
mongo --version

3️⃣ Optional: Run MongoDB shell
mongo
This opens the MongoDB shell where you can create databases and collections.


## 🌍 Transport & WebSocket Connection

Transport Protocol

OCPP 1.6 supports both SOAP and JSON over WebSocket.
Most modern implementations use JSON over WebSocket.
Communication is bi-directional and persistent:

Charge Point  ↔  Central System

WebSocket URL Format

The Charge Point (client) typically initiates the connection to the Central System (server):
ws://<central-system-host>:<port>/<ChargePointId>

Example:
ws://localhost:3000/<ChargePointID>

## OCPP JSON Message Format:

Each OCPP message is sent as a JSON array, not a plain object.
The format is:

[
  MessageTypeId,
  UniqueId,
  ActionOrResponse,
  Payload
]

| Field                | Description                                                                        |
| -------------------- | ---------------------------------------------------------------------------------- |
| **MessageTypeId**    | Indicates the type of OCPP message (2 = Call, 3 = CallResult, 4 = CallError)       |
| **UniqueId**         | Unique identifier (UUID) to match request and response                             |
| **ActionOrResponse** | For Call → the action name (e.g., BootNotification); For CallResult → payload only |
| **Payload**          | JSON object containing the data for the action                                     |

## Message Types:

| MessageTypeId | Type       | Direction                  |
| ------------- | ---------- | -------------------------- |
| 2             | Call       | Client → Server (Request)  |
| 3             | CallResult | Server → Client (Response) |
| 4             | CallError  | Error messages             |



Example: BootNotification (Charge Point → Central System)

Request (MessageTypeId = 2):
[
  2,
  "12345678-1234-5678-1234-567812345678",
  "BootNotification",
  {
    "chargePointVendor": "TP-Link",
    "chargePointModel": "Tapo-D225",
    "firmwareVersion": "1.0.0"
  }
]

Response (MessageTypeId = 3):
[
  3,
  "12345678-1234-5678-1234-567812345678",
  {
    "status": "Accepted",
    "currentTime": "2025-10-07T11:30:00Z",
    "interval": 300
  }
]

## Common OCPP Actions:

| Action                 | Direction | Purpose                                       |
| ---------------------- | --------- | --------------------------------------------- |
| BootNotification       | CP → CS   | Register charge point with the central system |
| Heartbeat              | CP → CS   | Periodic ping to indicate CP is alive         |
| Authorize              | CP → CS   | Verify if a tag/ID is allowed to charge       |
| StartTransaction       | CP → CS   | Start a charging session                      |
| StopTransaction        | CP → CS   | End a charging session                        |
| StatusNotification     | CP → CS   | Notify connector status changes               |
| MeterValues            | CP → CS   | Send energy usage data                        |
| RemoteStartTransaction | CS → CP   | Start charging remotely                       |
| RemoteStopTransaction  | CS → CP   | Stop charging remotely                        |
| ChangeConfiguration    | CS → CP   | Modify charge point configuration parameters  |
| GetConfiguration       | CS → CP   | Retrieve current configuration values         |
| Reset                  | CS → CP   | Reboot the charge point (soft/hard)           |
| GetDiagnostics         | CS → CP   | Request diagnostic logs from charge point     |
| UpdateFirmware         | CS → CP   | Trigger firmware update on charge point       |
| SendLocalList          | CS → CP   | Send/update local authorization list          |
| ReserveNow             | CS → CP   | Reserve a connector for a specific idTag            |
| CancelReservation      | CS → CP   | Cancel an existing connector reservation             |
| GetLocalListVersion    | CS → CP   | Retrieve current local authorization list version   |
| SetChargingProfile     | CS → CP   | Set or update a charging profile (power limits)     |
| GetCompositeSchedule   | CS → CP   | Request calculated charging schedule from CP        |
| ClearChargingProfile   | CS → CP   | Clear/remove an existing charging profile           |



## Basic Components in an OCPP Project:
Charge Point (Client) → runs in the charging station
Central System (Server) → backend server (e.g., Node.js, Python, Java)
WebSocket → persistent connection
Message Handler → to process different actions
UUID Generator → for unique IDs of each request

## Good Practices:
Use UUIDs for UniqueId fields.
Always respond to every Call with a matching UniqueId.
Handle error messages gracefully using MessageTypeId = 4.
Follow strict OCPP schema (there are JSON schema files available for validation).
Keep the connection alive (send Heartbeat periodically).

## Useful Links:
OCPP 1.6 JSON Specification PDF => https://www.openchargealliance.org/
Open Charge Alliance (OCA) => https://www.openchargealliance.org
OCPP JSON Schemas on GitHub => https://github.com/mobilityhouse/ocpp

##✅ Next Steps
Once the prerequisites are set up, you can clone this repository, install dependencies, and start your Node.js OCPP server.

git clone <your-repo-url>
cd <your-project>
npm install
npm run dev

## Create table of IdTag in the OCPP Database(GUI included steps)

use yourDatabaseName  // Switch to your DB

db.createCollection("IdTag")  // Optional — MongoDB creates it automatically on first insert

db.IdTag.insertOne({
  "__v": 0,
  "expiryDate": new Date("2025-10-26T07:34:31.418Z"),
  "parentTag": "TEST",
  "status": "Accepted",
  "idTag": "TEST5678"
});





## 🚗 OCPP Server Setup & Overview

This guide walks you through setting up the required environment (Node.js, npm, MongoDB) and gives you an introduction to the Open Charge Point Protocol (OCPP), including message formats, transport mechanisms, and commonly used actions.

##📋 Table of Contents

1.Prerequisites
Install Node.js & npm
Install MongoDB
2.Introduction to OCPP
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
node -v # Shows Node.js version
npm -v # Shows npm version

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

## Introduction to OCPP

The Open Charge Point Protocol (OCPP) is an open communication standard between Electric Vehicle (EV) charging stations (Charge Points) and a Central System (CS) or backend server.

It defines how charging stations:
Send status updates, transactions, meter values, and configuration information.
Receive commands and configuration updates from the central system.

OCPP Versions

OCPP 1.2 / 1.5 – Early versions
OCPP 1.6 – Most widely used today (supports SOAP and JSON over WebSocket)
OCPP 2.0 / 2.0.1 – Newer, more feature-rich, includes security profiles and enhanced functionality

## 🌍 Transport & WebSocket Connection

Transport Protocol

OCPP 1.6 supports both SOAP and JSON over WebSocket.
Most modern implementations use JSON over WebSocket.
Communication is bi-directional and persistent:

Charge Point ↔ Central System

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

use yourDatabaseName // Switch to your DB

db.createCollection("IdTag") // Optional — MongoDB creates it automatically on first insert

db.IdTag.insertOne({
"\_\_v": 0,
"expiryDate": new Date("2025-10-26T07:34:31.418Z"),
"parentTag": null,
"status": "Accepted",
"idTag": "TEST5678"
});

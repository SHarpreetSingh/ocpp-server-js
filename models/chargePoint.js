import mongoose from 'mongoose';

const connectorSchema = new mongoose.Schema({
  connectorId: { type: Number, required: true },
  status: { type: String, default: "Available" },
  currentTransactionId: { type: Number, default: 0 }, // To track active sessions
  connectorType: String, // e.g., "Type 2", "CHAdeMO"
});

const chargePointSchema = new mongoose.Schema({
  vendor: {
    type: String,
    required: true,
  },
  model: {
    type: String,
    required: true,
  },
  serialNumber: {
    type: String,
    required: true,
    minlength: 3,
    maxlength: 20
  },
  firmwareVersion: String,
  lastBoot: Date,
  status: { type: String, default: "Accepted" },
  heartbeatInterval: Number,
  connectors: [connectorSchema],
});



export default mongoose.model("ChargePoint", chargePointSchema);
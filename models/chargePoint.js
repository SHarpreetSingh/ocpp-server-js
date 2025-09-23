import mongoose from 'mongoose';

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
  },
  firmwareVersion: String,
  lastBoot: Date,
  status: { type: String, default: "Accepted" },
  heartbeatInterval: Number,
});

export default mongoose.model("ChargePoint", chargePointSchema);
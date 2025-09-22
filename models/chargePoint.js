import mongoose from 'mongoose';

const chargePointSchema = new mongoose.Schema({
  vendor: String,
  model: String,
  serialNumber: String, //chargePointId
  firmwareVersion: String,
  lastBoot: Date,
  status: { type: String, default: "Accepted" },
  heartbeatInterval: Number,
});

export default mongoose.model("ChargePoint", chargePointSchema);
import mongoose from "mongoose";

const idtagInfoSchema = new mongoose.Schema({
  idTag: {
    type: String,
    required: true,
    unique: true,
  },
  expiryDate: {
    type: Date,
    required: true,
  },
  parentTag: {
    type: String,
  },
  status: {
    type: String,
    enum: ["Accepted", "Blocked", "Expired", "Invalid", "ConcurrentTx"],
  },
});

export default mongoose.model("IdTagInfo", idtagInfoSchema);

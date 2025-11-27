import mongoose from "mongoose";

const idtagSchema = new mongoose.Schema(
  {
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
  },
  { timestamps: true }
);

export default mongoose.model("IdTag", idtagSchema);

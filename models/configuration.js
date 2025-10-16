import mongoose from "mongoose";

const configurationSchema = new mongoose.Schema(
  {
    chargePointID: {
      type: String,
      required: true,
      // index: true,
    },
    key: {
      type: String,
      required: true,
    },
    value: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: [
        "Accepted",
        "Rejected",
        "RebootRequired",
        "NotSupported",
        "Pending",
      ],
      default: "Pending",
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Configuration", configurationSchema);

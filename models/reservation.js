import mongoose from "mongoose";

const reservationSchema = new mongoose.Schema(
  {
    reservationId: {
      type: Number,
      required: true,
      unique: true,
    },
    connectorId: {
      type: Number,
      required: true,
      min: 0, // 0 means ANY connector can be reserved
    },
    idTag: {
      type: String,
      required: true,
    },
    parentIdTag: {
      type: String,
      default: null,
    },
    expiryDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["Active", "Expired", "Used", "Cancelled"],
      default: "Active",
    },
    // Optional: store why reservation expired or ended
    endReason: {
      type: String,
      enum: [
        "UserStartedCharging",
        "Expired",
        "ConnectorFaulted",
        "Unavailable",
        "Cancelled",
        null,
      ],
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for faster lookup
reservationSchema.index({ reservationId: 1 }, { unique: true });
reservationSchema.index({ connectorId: 1, status: 1 });
reservationSchema.index({ expiryDate: 1 });

export default mongoose.model("Reservation", reservationSchema);

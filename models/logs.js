import mongoose from "mongoose";

const logsSchema = new mongoose.Schema({
  uniqueId: {
    type: Number,
    required: true,
  },
  request: {
    type: String,
    required: true,
  },
  response: {
    type: String,
    required: true,
  },
  result: {
    type: String,
    enum: ["Pass", "Fail"],
  },
});

export default mongoose.model("Logs", logsSchema);

import mongoose from 'mongoose';


// --- Sub-Schema for real-time Meter Values ---
const MeterValueSchema = new mongoose.Schema({
    timestamp: { type: Date, required: true },
    meterValue: { type: Number, required: true }, // The total meter value at this point (Wh)

    // Structure for detailed electrical parameters (optional but recommended for robust data)
    sampledValue: [{
        measurand: { type: String },
        value: { type: String },
        unit: { type: String }
    }]
}, { _id: false });

// --- Main Transaction Schema ---
const TransactionSchema = new mongoose.Schema({
    // --- 1. Linkage to Charge Point ---
    // The link to the parent Charge Point document
    chargePoint: {
        type: String,  // Assuming you name your CP model 'ChargePoint'
        required: true
    },
    // The specific connector on the CP used for this transaction
    connectorId: { type: Number, required: true },

    // --- 2. Core OCPP Identifiers ---
    // The unique transactionId returned by the CS in StartTransaction.conf
    csTransactionId: {
        type: Number,
        required: true,
        unique: true,
        index: true,
        sparse: true
    },
    // User's Identifier from Authorize.req/StartTransaction.req
    idTag: {
        type: String,
        required: true, index: true,
        trim: true
    },

    // --- 3. Start Transaction Data (from StartTransaction.req) ---
    start_timestamp: { type: Date, required: true },
    meterStart: { type: Number, required: true }, // meterStart (Wh)
    reservationId: { type: Number, optional: true },

    // --- 4. Intermediate Meter Data (from MeterValues.req) ---
    meterValues: [MeterValueSchema], // Array of periodic meter and electrical readings

    // --- 5. Stop Transaction Data (from StopTransaction.req) ---
    isFinished: { type: Boolean, default: false, index: true }, // Status flag
    stop_timestamp: { type: Date, required: function () { return this.isFinished; } },
    meterStop: { type: Number, required: function () { return this.isFinished; } }, // meterStop (Wh)
    stopReason: { type: String }, // Reason for stopping (e.g., 'EVDisconnected', 'Local')

    // --- 6. Billing & Metadata ---
    finalCost: { type: Number, default: 0 },

}, { timestamps: true }); // Mongoose adds createdAt and updatedAt


// Optional: Add custom validation logic before saving
// startTransactionSchema.pre('save', function (next) {
//   if (!this.timestamp || isNaN(Date.parse(this.timestamp))) {
//     return next(new Error('Invalid timestamp format. Must be ISO 8601.'));
//   }
//   next();
// });

export default mongoose.model('Transaction', TransactionSchema);
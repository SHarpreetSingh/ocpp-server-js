import mongoose from 'mongoose';

// --- 1. Sub-Schema for Sampled Electrical Values (from sampledValue array) ---
// This schema represents a single electrical measurement (e.g., 'Voltage', 'Current.L1').
const SampledValueSchema = new mongoose.Schema({
    value: { 
        type: String, 
        required: true 
    }, // REQUIRED by OCPP, sent as a string (e.g., "1200.5")
    measurand: { 
        type: String, 
        // Optional: Can add enum validation here if needed
    },
    unit: { 
        type: String 
    },
    context: { 
        type: String 
    },
    // Include other optional fields (format, phase, location) if you plan to store them
    phase: {
        type: String
    },
    location: {
        type: String
    }
}, { _id: false });

// ---------------------------------------------------------------------------------

// --- 2. Sub-Schema for a Time-Stamped Meter Reading (from meterValue array) ---
// This schema represents one element from the 'meterValue' array in MeterValues.req
// It links a timestamp to an array of specific SampledValue measurements.
const MeterValueSchema = new mongoose.Schema({
    timestamp: { 
        type: Date, 
        required: true 
    },
    // The total register reading is often implicit in the 'sampledValue' array 
    // using the 'Energy.Active.Import.Register' measurand.
    
    // An array of the specific electrical measurements taken at this timestamp
    sampledValues: {
        type: [SampledValueSchema], // Array of the SampledValue sub-schema
        required: true, 
        minlength: 1 // Must contain at least one sampled value
    }
}, { _id: false });

// ---------------------------------------------------------------------------------

// --- 3. Main Transaction Schema ---
const TransactionSchema = new mongoose.Schema({
    // --- 1. Linkage to Charge Point ---
    chargePoint: {
        type: String,
        required: true
    },
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

    // --- 3. Start Transaction Data ---
    start_timestamp: { type: Date, required: true },
    meterStart: { type: Number, required: true }, // meterStart (Wh)
    reservationId: { type: Number, optional: true },

    // --- 4. Meter Data Storage (UPDATED SECTION) ---
    // The name of this field is often changed to be clearer than just 'meterValues'
    readings: {
        type: [MeterValueSchema], // Array of periodic meter and electrical readings
        default: []
    },

    // --- 5. Stop Transaction Data (from StopTransaction.req) ---
    isFinished: { type: Boolean, default: false, index: true }, // Status flag
    stop_timestamp: { type: Date, required: function () { return this.isFinished; } },
    meterStop: { type: Number, required: function () { return this.isFinished; } }, // meterStop (Wh)
    stopReason: { type: String }, // Reason for stopping (e.g., 'EVDisconnected', 'Local')

    // --- 6. Billing & Metadata ---
    finalCost: { type: Number, default: 0 },

}, { timestamps: true });


// Optional: Add custom validation logic before saving
// startTransactionSchema.pre('save', function (next) {
//   if (!this.timestamp || isNaN(Date.parse(this.timestamp))) {
//     return next(new Error('Invalid timestamp format. Must be ISO 8601.'));
//   }
//   next();
// });

export default mongoose.model('Transaction', TransactionSchema);
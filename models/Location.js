const locationSchema = new mongoose.Schema({
    mainCity: { type: String, required: true, unique: true },  // e.g., "Nakuru"
    subLocations: [{
      name: { type: String, required: true },                  // e.g., "Milimani"
      areas: [{ type: String }]                                // e.g., ["Pipeline Estate", "Kaptembwo"]
    }]
  }, { timestamps: true });
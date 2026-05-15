const mongoose = require('mongoose');

const LocalAreaSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now }
});

const SubLocationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  localAreas: [LocalAreaSchema]    // dynamic array of local areas
});

const CitySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  subLocations: [SubLocationSchema]
});

const SiteSchema = new mongoose.Schema({
  name: { type: String, required: true },          // e.g., "Rift Valley"
  regionCode: { type: String, uppercase: true, trim: true, unique: true }, // e.g., "RV"

  // Nested coverage: cities → subLocations → localAreas
  coverage: [CitySchema],

  // Payment integration (per site)
  payment: {
    tillNumber: { type: String, trim: true },  // legacy fallback
    kopokopo: {
      environment: { type: String, enum: ['sandbox', 'production'], default: 'sandbox' },
      clientId: { type: String, trim: true },
      clientSecret: { type: String, trim: true },
      apiKey: { type: String, trim: true },
      tillNumber: { type: String, trim: true }
    },
    mpesa: {
      consumerKey: String,
      consumerSecret: String,
      passkey: String,
      shortcode: String
    }
  },

  // Optional legacy location object (for geolocation)
  location: {
    address: String,
    county: String,
    coordinates: { latitude: Number, longitude: Number }
  },

  // Contact person for the region
  contactPerson: {
    name: String,
    phone: String,
    email: String
  },

  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Virtual populate for routers (unchanged)
SiteSchema.virtual('routers', {
  ref: 'Router',
  localField: '_id',
  foreignField: 'site'
});

SiteSchema.methods.getPrimaryRouter = async function() {
  const Router = mongoose.model('Router');
  return await Router.findOne({ site: this._id });
};

// Utility method to find or create a local area
SiteSchema.methods.addLocalAreaIfNotExists = async function(cityName, subLocationName, localAreaName) {
  const city = this.coverage.find(c => c.name === cityName);
  if (!city) throw new Error(`City "${cityName}" not found in this site`);
  
  const subLoc = city.subLocations.find(s => s.name === subLocationName);
  if (!subLoc) throw new Error(`Sub-location "${subLocationName}" not found in city "${cityName}"`);
  
  let existing = subLoc.localAreas.find(la => la.name === localAreaName);
  if (!existing) {
    subLoc.localAreas.push({ name: localAreaName });
    await this.save();
    // Return the newly added local area
    existing = subLoc.localAreas.find(la => la.name === localAreaName);
  }
  return existing;
};

// Add to SiteSchema.methods

// Find or create a city
SiteSchema.methods.addCityIfNotExists = async function(cityName) {
  if (!cityName) return null;
  const existing = this.coverage.find(c => c.name === cityName);
  if (existing) return existing;
  // Create new city with empty subLocations
  this.coverage.push({ name: cityName, subLocations: [] });
  await this.save();
  // Return the newly added city
  return this.coverage.find(c => c.name === cityName);
};

// Find or create a sub‑location within a city
SiteSchema.methods.addSubLocationIfNotExists = async function(cityName, subLocationName) {
  if (!cityName || !subLocationName) return null;
  const city = this.coverage.find(c => c.name === cityName);
  if (!city) {
    // Optionally create the city first
    await this.addCityIfNotExists(cityName);
    return this.addSubLocationIfNotExists(cityName, subLocationName);
  }
  const existing = city.subLocations.find(s => s.name === subLocationName);
  if (existing) return existing;
  city.subLocations.push({ name: subLocationName, localAreas: [] });
  await this.save();
  return city.subLocations.find(s => s.name === subLocationName);
};

// (Keep existing addLocalAreaIfNotExists)

module.exports = mongoose.model('Site', SiteSchema);
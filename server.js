'use strict';

const express = require('express');
const axios = require('axios');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Uploads directory
// ---------------------------------------------------------------------------
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Multer – image uploads
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `aircraft-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are accepted'));
    }
  }
});

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------------------
const flightsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please wait a moment.' }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upload requests, please wait a moment.' }
});

// ---------------------------------------------------------------------------
// ICAO airline code → airline name lookup table
// ---------------------------------------------------------------------------
const AIRLINES = {
  AAL: 'American Airlines',
  BAW: 'British Airways',
  AFR: 'Air France',
  DLH: 'Lufthansa',
  UAE: 'Emirates',
  SIA: 'Singapore Airlines',
  QFA: 'Qantas',
  UAL: 'United Airlines',
  DAL: 'Delta Air Lines',
  SWA: 'Southwest Airlines',
  RYR: 'Ryanair',
  EZY: 'easyJet',
  VLG: 'Vueling',
  IBE: 'Iberia',
  KLM: 'KLM Royal Dutch Airlines',
  AUA: 'Austrian Airlines',
  THY: 'Turkish Airlines',
  SVA: 'Saudia',
  ETH: 'Ethiopian Airlines',
  KQA: 'Kenya Airways',
  QTR: 'Qatar Airways',
  ETD: 'Etihad Airways',
  FIN: 'Finnair',
  SAS: 'Scandinavian Airlines',
  NAX: 'Norwegian Air Shuttle',
  TAP: 'TAP Air Portugal',
  AEE: 'Aegean Airlines',
  CSN: 'China Southern Airlines',
  CCA: 'Air China',
  CES: 'China Eastern Airlines',
  JAL: 'Japan Airlines',
  ANA: 'All Nippon Airways',
  KAL: 'Korean Air',
  AAR: 'Asiana Airlines',
  THA: 'Thai Airways',
  MAS: 'Malaysia Airlines',
  GIA: 'Garuda Indonesia',
  PAL: 'Philippine Airlines',
  VNA: 'Vietnam Airlines',
  AIC: 'Air India',
  GOI: 'IndiGo',
  JBU: 'JetBlue Airways',
  ASA: 'Alaska Airlines',
  HAL: 'Hawaiian Airlines',
  FFT: 'Frontier Airlines',
  NKS: 'Spirit Airlines',
  GTI: 'Atlas Air',
  UPS: 'UPS Airlines',
  FDX: 'FedEx Express',
  DHL: 'DHL Air',
  CAL: 'China Airlines',
  EVA: 'EVA Air',
  CPA: 'Cathay Pacific',
  AZA: 'ITA Airways',
  BEL: 'Brussels Airlines',
  SWR: 'Swiss International Air Lines',
  WZZ: 'Wizz Air',
  TOM: 'TUI Airways',
  EIN: 'Aer Lingus',
  RAM: 'Royal Air Maroc',
  MSR: 'EgyptAir',
  ANZ: 'Air New Zealand',
  LAN: 'LATAM Airlines',
  TAM: 'LATAM Brasil',
  GLO: 'Gol Airlines',
  AZU: 'Azul Brazilian Airlines',
  AVA: 'Avianca',
  AMX: 'Aeromexico',
  VOI: 'Volaris',
  VIV: 'VivaAerobus',
  SKW: 'SkyWest Airlines',
  ENY: 'Envoy Air',
  RPA: 'Republic Airways',
  PDT: 'Piedmont Airlines',
  OZW: 'Helvetic Airways',
  BCS: 'European Air Transport',
  ABX: 'ABX Air',
  CLX: 'Cargolux',
  MPH: 'Martinair',
  TGW: 'Thomas Cook Airlines Scandinavia',
  EXS: 'Jet2',
  MON: 'Monarch Airlines',
  BAG: 'Berlin Brandenburg',
  CFG: 'Condor',
  HLF: 'Hapag-Lloyd Express',
  GWI: 'Germanwings',
  EWG: 'Eurowings',
  DBA: 'dba',
  TUI: 'TUIfly',
  HHN: 'Hahn Air',
  SXS: 'SunExpress Deutschland',
  SXD: 'SunExpress',
  TVS: 'Travel Service',
  CSA: 'Czech Airlines',
  LOT: 'LOT Polish Airlines',
  MAY: 'Malév Hungarian Airlines',
  ROT: 'TAROM',
  BUC: 'Blue Air',
  WIF: 'Wideroe',
  NOZ: 'Norwegian Air Sweden',
  SKC: 'Sky Airlines'
};

// ---------------------------------------------------------------------------
// Helper: resolve airline name from callsign prefix
// ---------------------------------------------------------------------------
function getAirline(callsign) {
  if (!callsign || callsign.length < 3) return null;
  const code = callsign.slice(0, 3).toUpperCase();
  return AIRLINES[code] || null;
}

// ---------------------------------------------------------------------------
// Haversine distance helper (km)
// ---------------------------------------------------------------------------
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// GET /api/flights
// Query params: lat, lon, radius (km, default 50, max 50)
// ---------------------------------------------------------------------------
app.get('/api/flights', flightsLimiter, async (req, res) => {
  const { lat, lon, radius = '50' } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: 'Query parameters "lat" and "lon" are required.' });
  }

  const latF = parseFloat(lat);
  const lonF = parseFloat(lon);
  const radiusKm = Math.min(Math.max(parseFloat(radius) || 50, 1), 50);

  if (isNaN(latF) || isNaN(lonF) || latF < -90 || latF > 90 || lonF < -180 || lonF > 180) {
    return res.status(400).json({ error: 'Invalid coordinates.' });
  }

  // Convert radius to bounding-box degrees (approximate)
  const latDelta = radiusKm / 111.0;
  const lonDelta = radiusKm / (111.0 * Math.cos((latF * Math.PI) / 180));

  const lamin = latF - latDelta;
  const lamax = latF + latDelta;
  const lomin = lonF - lonDelta;
  const lomax = lonF + lonDelta;

  try {
    const response = await axios.get('https://opensky-network.org/api/states/all', {
      params: { lamin, lamax, lomin, lomax },
      timeout: 15000,
      headers: { 'User-Agent': 'FlightTracker/1.0 (github.com/Drivax/Flight-tracking)' }
    });

    const states = response.data.states || [];

    const flights = states
      .map((s) => ({
        icao24: s[0],
        callsign: (s[1] || '').trim(),
        originCountry: s[2],
        longitude: s[5],
        latitude: s[6],
        baroAltitude: s[7],   // metres
        onGround: s[8],
        velocity: s[9],       // m/s
        heading: s[10],       // degrees
        verticalRate: s[11],  // m/s
        geoAltitude: s[13],   // metres
        squawk: s[14]
      }))
      .filter((f) => !f.onGround && f.latitude != null && f.longitude != null
                  && haversineKm(latF, lonF, f.latitude, f.longitude) <= radiusKm)
      .map((f) => ({
        ...f,
        airline: getAirline(f.callsign)
      }));

    res.json({ flights, time: response.data.time, count: flights.length });
  } catch (err) {
    console.error('OpenSky API error:', err.message);
    const status = err.response?.status;
    if (status === 429) {
      return res.status(429).json({ error: 'OpenSky rate limit reached. Please wait a moment and try again.' });
    }
    res.status(502).json({ error: 'Could not fetch flight data. Please try again shortly.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/upload – accept one aircraft image
// ---------------------------------------------------------------------------
app.post('/api/upload', uploadLimiter, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided.' });
  }
  res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

// ---------------------------------------------------------------------------
// DELETE /api/upload/:filename
// ---------------------------------------------------------------------------
app.delete('/api/upload/:filename', uploadLimiter, (req, res) => {
  // Sanitise – strip any directory components
  const filename = path.basename(req.params.filename);
  const filepath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'File not found.' });
  }

  fs.unlinkSync(filepath);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`✈️  Flight Tracker running → http://localhost:${PORT}`);
});

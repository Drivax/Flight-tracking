# ✈️ FlightTracker

A functional web application that identifies flights overhead based on your location — showing flight number, aircraft details, airline, speed, altitude, heading, and origin country. You can also upload a photo of the aircraft to help visually identify it.

![FlightTracker UI](https://github.com/user-attachments/assets/fd0d8fa1-119e-4244-a53c-0a435f0a5e5e)

## Features

- **Live flight data** from the [OpenSky Network](https://opensky-network.org/) (free, no API key required)
- **Interactive map** (Leaflet.js + OpenStreetMap) with rotating aircraft icons
- **Flight details**: callsign, airline name, ICAO24, origin country, altitude (ft + m), speed (km/h + knots), heading, vertical rate, squawk code
- **Distance** from your position to each aircraft
- **Aircraft photo upload**: take a photo of the aircraft overhead and associate it with a flight
- **Geolocation**: one-click "My Location" button, or enter coordinates manually
- **Configurable radius**: 50 – 300 km search area
- **Auto-refresh** every 30 seconds
- **External links** to FlightRadar24, FlightAware, and OpenSky for additional details
- Responsive design — works on mobile and desktop

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) ≥ 18

### Installation

```bash
git clone https://github.com/Drivax/Flight-tracking.git
cd Flight-tracking
npm install
npm start
```

Open your browser at **http://localhost:3000**.

### Usage

1. Click **📍 My Location** to use your device's GPS, or enter **Latitude / Longitude** manually and click **🔍 Search**.
2. Aircraft icons appear on the map. Orange icons = nearby flights; blue = selected flight.
3. Click any icon on the map **or** a flight card in the sidebar to see full details.
4. Optionally tap **📸 Tap to capture or choose an image** to upload a photo of an aircraft overhead — the photo appears in the flight detail panel to help you identify the match.
5. Flight data refreshes automatically every 30 seconds. Press **🔄** to refresh manually.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3000`  | HTTP port the server listens on |

## Tech Stack

| Layer    | Technology |
|----------|-----------|
| Backend  | Node.js + Express |
| HTTP client | Axios |
| File upload | Multer 2.x |
| Frontend map | Leaflet.js 1.9 + OpenStreetMap |
| Flight data | OpenSky Network REST API |

## License

MIT

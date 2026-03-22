'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let map, userMarker, circleLayer;
const flightMarkers = new Map(); // icao24 → leaflet marker
let userLocation = null;         // { lat, lng }
let currentFlights = [];
let selectedIcao = null;
let uploadedPhotoUrl = null;
let refreshTimer = null;

// ── Helpers ────────────────────────────────────────────────────────────────
function metresToFeet(m)  { return m != null ? Math.round(m * 3.281) : null; }
function msToKmh(ms)      { return ms != null ? Math.round(ms * 3.6) : null; }
function msToKnots(ms)    { return ms != null ? Math.round(ms * 1.944) : null; }

function headingLabel(deg) {
  if (deg == null) return '—';
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return `${Math.round(deg)}° (${dirs[Math.round(deg / 45) % 8]})`;
}

function bearingLabel(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(bearing / 45) % 8];
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function setStatus(msg) {
  document.getElementById('status-text').textContent = msg;
}

function showLoading(visible) {
  document.getElementById('loading').hidden = !visible;
}

// ── Leaflet map init ───────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: true }).setView([48.85, 2.35], 6);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  map.on('click', (e) => {
    setLocationAndSearch(e.latlng.lat, e.latlng.lng);
  });
}

// ── User-location marker ───────────────────────────────────────────────────
function placeUserMarker(lat, lng) {
  const icon = L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:var(--accent);
                       border:3px solid #fff;box-shadow:0 0 8px rgba(79,195,247,.8)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });

  if (userMarker) {
    userMarker.setLatLng([lat, lng]);
  } else {
    userMarker = L.marker([lat, lng], { icon }).addTo(map);
  }

  if (circleLayer) map.removeLayer(circleLayer);
  const radiusKm = parseInt(document.getElementById('radius-input').value, 10) || 50;
  circleLayer = L.circle([lat, lng], {
    radius: radiusKm * 1000,
    color: 'var(--accent)',
    fillColor: 'var(--accent)',
    fillOpacity: 0.04,
    weight: 1,
    dashArray: '4 4'
  }).addTo(map);
}

// ── Aircraft icons ─────────────────────────────────────────────────────────
function makeAircraftIcon(heading, icao24) {
  const isSelected = icao24 === selectedIcao;
  const color = isSelected ? '#4fc3f7' : '#ff9800';
  const rot   = heading != null ? heading : 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="22" height="22" fill="${color}" style="transform:rotate(${rot}deg);display:block">
    <path d="M21 16v-2l-8-5V3.5C13 2.67 12.33 2 11.5 2S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
  </svg>`;
  return L.divIcon({
    className: `aircraft-icon${isSelected ? ' selected' : ''}`,
    html: svg,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
}

// ── Clear all flight markers ───────────────────────────────────────────────
function clearFlightMarkers() {
  flightMarkers.forEach((marker) => map.removeLayer(marker));
  flightMarkers.clear();
}

// ── Draw flights on map ────────────────────────────────────────────────────
function drawFlightMarkers(flights) {
  clearFlightMarkers();
  flights.forEach((f) => {
    if (f.latitude == null || f.longitude == null) return;
    const icon   = makeAircraftIcon(f.heading, f.icao24);
    const label  = f.callsign || f.icao24;
    const alt    = f.baroAltitude != null ? `${metresToFeet(f.baroAltitude).toLocaleString()} ft` : '';
    const popup  = L.popup({ closeButton: false, className: 'ft-popup', offset: [0, -8] })
      .setContent(`<b>${label}</b>${alt ? `<br/>${alt}` : ''}`);
    const marker = L.marker([f.latitude, f.longitude], { icon })
      .bindPopup(popup)
      .on('click', () => selectFlight(f.icao24));
    marker.addTo(map);
    flightMarkers.set(f.icao24, marker);
  });
}

// ── Render sidebar list ────────────────────────────────────────────────────
function renderFlightList(flights) {
  const list  = document.getElementById('flights-list');
  const empty = document.getElementById('flights-empty');
  const count = document.getElementById('flight-count');

  count.textContent = flights.length ? `${flights.length} flight${flights.length !== 1 ? 's' : ''}` : '';

  if (!flights.length) {
    list.hidden  = true;
    empty.hidden = false;
    empty.textContent = 'No airborne flights found in this area';
    return;
  }

  empty.hidden = true;
  list.hidden  = false;
  list.innerHTML = '';

  // Sort by distance from user
  const sorted = userLocation
    ? [...flights].sort((a, b) =>
        haversineKm(userLocation.lat, userLocation.lng, a.latitude, a.longitude) -
        haversineKm(userLocation.lat, userLocation.lng, b.latitude, b.longitude))
    : flights;

  sorted.forEach((f) => {
    const alt  = f.baroAltitude != null ? `${metresToFeet(f.baroAltitude).toLocaleString()} ft` : '—';
    const spd  = f.velocity    != null ? `${msToKmh(f.velocity)} km/h` : '';
    const dist = userLocation
      ? `${Math.round(haversineKm(userLocation.lat, userLocation.lng, f.latitude, f.longitude))} km`
      : '';
    const bearing = userLocation
      ? bearingLabel(userLocation.lat, userLocation.lng, f.latitude, f.longitude)
      : '';

    const li = document.createElement('li');
    li.className = `flight-card${f.icao24 === selectedIcao ? ' active' : ''}`;
    li.dataset.icao = f.icao24;
    li.innerHTML = `
      <div class="fc-top">
        <span class="fc-callsign">${f.callsign || f.icao24}</span>
        <span class="fc-altitude">${alt}</span>
      </div>
      ${f.airline ? `<span class="fc-airline">${f.airline}</span>` : ''}
      <div class="fc-meta">
        ${spd ? `<span>🚀 ${spd}</span>` : ''}
        ${dist ? `<span>📍 ${dist}</span>` : ''}
        ${bearing ? `<span>🧭 ${bearing}</span>` : ''}
        <span>🌍 ${f.originCountry || '—'}</span>
      </div>`;
    li.addEventListener('click', () => selectFlight(f.icao24));
    list.appendChild(li);
  });
}

// ── Select a flight ────────────────────────────────────────────────────────
function selectFlight(icao24) {
  if (selectedIcao === icao24) {
    deselectFlight();
    return;
  }

  selectedIcao = icao24;
  const f = currentFlights.find((x) => x.icao24 === icao24);
  if (!f) return;

  // Refresh icon colours
  flightMarkers.forEach((marker, id) => {
    marker.setIcon(makeAircraftIcon(
      currentFlights.find((x) => x.icao24 === id)?.heading,
      id
    ));
  });

  // Highlight list item
  document.querySelectorAll('.flight-card').forEach((el) => {
    el.classList.toggle('active', el.dataset.icao === icao24);
  });

  // Populate detail panel
  const altFt  = f.baroAltitude != null ? `${metresToFeet(f.baroAltitude).toLocaleString()} ft  (${Math.round(f.baroAltitude)} m)` : '—';
  const spdKmh = f.velocity     != null ? `${msToKmh(f.velocity)} km/h  (${msToKnots(f.velocity)} kn)` : '—';
  const vrate  = f.verticalRate != null
    ? (f.verticalRate > 0.5 ? `↑ ${Math.round(f.verticalRate)} m/s` : f.verticalRate < -0.5 ? `↓ ${Math.abs(Math.round(f.verticalRate))} m/s` : '→ Level')
    : '—';
  const dist = userLocation
    ? `${Math.round(haversineKm(userLocation.lat, userLocation.lng, f.latitude, f.longitude))} km`
    : '—';

  document.getElementById('detail-callsign').textContent = f.callsign || f.icao24;
  document.getElementById('d-airline').textContent   = f.airline        || '—';
  document.getElementById('d-icao').textContent      = (f.icao24 || '—').toUpperCase();
  document.getElementById('d-country').textContent   = f.originCountry  || '—';
  document.getElementById('d-altitude').textContent  = altFt;
  document.getElementById('d-speed').textContent     = spdKmh;
  document.getElementById('d-heading').textContent   = headingLabel(f.heading);
  document.getElementById('d-vrate').textContent     = vrate;
  document.getElementById('d-squawk').textContent    = f.squawk         || '—';
  document.getElementById('d-distance').textContent  = dist;
  document.getElementById('d-bearing').textContent   = userLocation
    ? bearingLabel(userLocation.lat, userLocation.lng, f.latitude, f.longitude)
    : '—';

  // External links
  const cs = encodeURIComponent((f.callsign || f.icao24).toLowerCase());
  document.getElementById('link-fr24').href = `https://www.flightradar24.com/${cs}`;
  document.getElementById('link-fa').href   = `https://flightaware.com/live/flight/${cs}`;
  document.getElementById('link-osm').href  = `https://opensky-network.org/aircraft-profile?icao24=${f.icao24}`;

  // Photo
  const photoDiv = document.getElementById('detail-photo');
  if (uploadedPhotoUrl) {
    document.getElementById('detail-photo-img').src = uploadedPhotoUrl;
    photoDiv.hidden = false;
  } else {
    photoDiv.hidden = true;
  }

  document.getElementById('detail-panel').hidden = false;

  // Pan map to flight
  map.panTo([f.latitude, f.longitude]);
}

function deselectFlight() {
  selectedIcao = null;
  document.getElementById('detail-panel').hidden = true;
  document.querySelectorAll('.flight-card').forEach((el) => el.classList.remove('active'));
  flightMarkers.forEach((marker, id) => {
    marker.setIcon(makeAircraftIcon(
      currentFlights.find((x) => x.icao24 === id)?.heading,
      id
    ));
  });
}

// ── Fetch flights from server ──────────────────────────────────────────────
async function fetchFlights(lat, lng) {
  showLoading(true);
  const radius = document.getElementById('radius-input').value || 50;

  try {
    const res = await fetch(`/api/flights?lat=${lat}&lon=${lng}&radius=${radius}`);
    const data = await res.json();

    if (!res.ok) {
      setStatus(`⚠️ ${data.error || 'Error fetching flights'}`);
      showLoading(false);
      return;
    }

    currentFlights = data.flights || [];
    drawFlightMarkers(currentFlights);
    renderFlightList(currentFlights);

    const ts = data.time ? new Date(data.time * 1000).toLocaleTimeString() : new Date().toLocaleTimeString();
    setStatus(`Last updated: ${ts}`);

    // If currently selected flight still in list, refresh detail
    if (selectedIcao && currentFlights.find((f) => f.icao24 === selectedIcao)) {
      selectFlight(selectedIcao);
    } else if (selectedIcao) {
      deselectFlight();
    }
  } catch (err) {
    setStatus('⚠️ Network error — check your connection');
    console.error(err);
  } finally {
    showLoading(false);
  }
}

// ── Set location and trigger search ───────────────────────────────────────
function setLocationAndSearch(lat, lng) {
  userLocation = { lat, lng };

  // Sync inputs
  document.getElementById('lat-input').value = lat.toFixed(4);
  document.getElementById('lon-input').value = lng.toFixed(4);

  placeUserMarker(lat, lng);
  map.setView([lat, lng], 8);

  // Hide the hint
  document.getElementById('map-hint').classList.add('hidden');

  // Enable refresh button
  document.getElementById('refresh-btn').disabled = false;

  setStatus('Fetching flights…');
  fetchFlights(lat, lng);

  // Auto-refresh every 30 seconds
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => fetchFlights(lat, lng), 30000);
}

// ── Geolocation ────────────────────────────────────────────────────────────
function useMyLocation() {
  if (!navigator.geolocation) {
    setStatus('⚠️ Geolocation is not supported by your browser');
    return;
  }
  setStatus('Requesting GPS position…');
  navigator.geolocation.getCurrentPosition(
    (pos) => setLocationAndSearch(pos.coords.latitude, pos.coords.longitude),
    (err) => setStatus(`⚠️ Could not get location: ${err.message}`)
  );
}

// ── Image upload ───────────────────────────────────────────────────────────
function initUpload() {
  const dropzone  = document.getElementById('dropzone');
  const input     = document.getElementById('photo-input');
  const preview   = document.getElementById('drop-preview');
  const placeholder = document.getElementById('drop-placeholder');
  const previewImg  = document.getElementById('preview-img');
  const removeBtn   = document.getElementById('remove-photo-btn');

  // Click or keyboard on dropzone → open file picker
  dropzone.addEventListener('click', (e) => {
    if (e.target !== removeBtn && !removeBtn.contains(e.target)) {
      input.click();
    }
  });
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') input.click();
  });

  // Drag-and-drop
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--accent)'; });
  dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  });

  input.addEventListener('change', () => {
    if (input.files[0]) uploadFile(input.files[0]);
  });

  removeBtn.addEventListener('click', async () => {
    if (uploadedPhotoUrl) {
      const filename = uploadedPhotoUrl.split('/').pop();
      try { await fetch(`/api/upload/${filename}`, { method: 'DELETE' }); } catch (_) { /* ignore */ }
      uploadedPhotoUrl = null;
    }
    previewImg.src  = '';
    preview.hidden  = true;
    placeholder.hidden = false;
    input.value = '';

    // Remove photo from detail panel if open
    const photoDiv = document.getElementById('detail-photo');
    photoDiv.hidden = true;
  });

  async function uploadFile(file) {
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file.');
      return;
    }
    const fd = new FormData();
    fd.append('image', file);

    setStatus('Uploading photo…');
    try {
      const res  = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      uploadedPhotoUrl = data.url;
      previewImg.src   = data.url;
      placeholder.hidden = true;
      preview.hidden     = false;
      setStatus('Photo uploaded — select a flight to associate it');

      // Show photo in open detail panel
      if (selectedIcao) {
        document.getElementById('detail-photo-img').src = data.url;
        document.getElementById('detail-photo').hidden = false;
      }
    } catch (err) {
      setStatus(`⚠️ Upload error: ${err.message}`);
    }
  }
}

// ── Wire up UI events ──────────────────────────────────────────────────────
function initControls() {
  document.getElementById('geo-btn').addEventListener('click', useMyLocation);

  document.getElementById('search-btn').addEventListener('click', () => {
    const lat = parseFloat(document.getElementById('lat-input').value);
    const lng = parseFloat(document.getElementById('lon-input').value);
    if (isNaN(lat) || isNaN(lng)) {
      setStatus('⚠️ Please enter valid latitude and longitude');
      return;
    }
    setLocationAndSearch(lat, lng);
  });

  document.getElementById('refresh-btn').addEventListener('click', () => {
    if (userLocation) fetchFlights(userLocation.lat, userLocation.lng);
  });

  document.getElementById('detail-close').addEventListener('click', deselectFlight);

  // Allow pressing Enter in coordinate inputs to trigger search
  ['lat-input', 'lon-input'].forEach((id) => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('search-btn').click();
    });
  });

  // Redraw search circle when radius changes
  document.getElementById('radius-input').addEventListener('change', () => {
    if (userLocation) placeUserMarker(userLocation.lat, userLocation.lng);
  });
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initControls();
  initUpload();
});

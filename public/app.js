const soundHistory = {
  sona1: [],
  sona2: [],
  sona3: []
};

const CACHE_KEY = "sona_sensor_cache";
const FETCH_LEADER_KEY = "sona_fetch_leader";
const FETCH_LEADER_TTL_MS = 35 * 1000;
const historyStore = window.SonaHistoryStore || null;

function loadSensorCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : { sona1: null, sona2: null, sona3: null };
  } catch { return { sona1: null, sona2: null, sona3: null }; }
}

function saveSensorCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* ignore */ }
}

function appendToHistory(incoming) {
  if (historyStore && typeof historyStore.appendRows === "function") {
    historyStore.appendRows(incoming || []);
    return;
  }

  try {
    const raw = localStorage.getItem("sona_history");
    const history = raw ? JSON.parse(raw) : [];
    const existingKeys = new Set(history.map((r) => `${r.sensor_id}|${r.timestamp}`));
    for (const row of incoming) {
      const key = `${row.sensor_id}|${row.timestamp}`;
      if (!existingKeys.has(key)) { history.push(row); existingKeys.add(key); }
    }
    localStorage.setItem("sona_history", JSON.stringify(history.slice(-12000)));
  } catch { /* ignore */ }
}

async function bootstrapHistory() {
  if (!historyStore || typeof historyStore.ensureSeeded !== "function") return;
  try {
    await historyStore.ensureSeeded();
  } catch {
    // ignore seed load errors
  }
}

// Restore last known readings instantly on page load
const sensorCache = loadSensorCache();

const sensorColors = {
  sona1: "#9FD0FF",
  sona2: "#A8FFB0",
  sona3: "#FFB3D9"
};

const maxPoints = 120;
const sensorIds = ["sona1", "sona2", "sona3"];
const DASHBOARD_WINDOW_MS = 60 * 1000;
const DASHBOARD_REFRESH_MS = 30 * 1000;
const SENSOR_LIVE_WINDOW_MS = 60 * 1000;
const HEATMAP_DB_MIN = 35;
const HEATMAP_DB_MAX = 95;
const HEATMAP_IDW_POWER = 2;
const HEATMAP_SENSOR_LAYOUT = {
  sona1: { x: 20, y: 50, label: "S1" },
  sona2: { x: 50, y: 40, label: "S2" },
  sona3: { x: 75, y: 60, label: "S3" }
};

const canvas = document.getElementById("waveCanvas");
const ctx = canvas.getContext("2d");
const heatmapCanvas = document.getElementById("dashboardHeatmapCanvas");
const heatmapCtx = heatmapCanvas ? heatmapCanvas.getContext("2d") : null;
let isAwsFetchInProgress = false;

// Returns true if this tab should be the one to hit AWS this cycle.
// Uses a shared localStorage timestamp so only one tab fetches at a time.
function claimFetchLeadership() {
  try {
    const now = Date.now();
    const raw = localStorage.getItem(FETCH_LEADER_KEY);
    if (raw && now - Number(raw) < FETCH_LEADER_TTL_MS) return false;
    localStorage.setItem(FETCH_LEADER_KEY, String(now));
    return true;
  } catch { return true; }
}

function goToSensor(sensorId) {
  window.location.href = `/history.html?sensor=${sensorId}`;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}

function resizeHeatmapCanvas() {
  if (!heatmapCanvas || !heatmapCtx) return;

  const rect = heatmapCanvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  heatmapCanvas.width = Math.max(1, Math.round(rect.width * pixelRatio));
  heatmapCanvas.height = Math.max(1, Math.round(rect.height * pixelRatio));
  heatmapCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function drawGrid(w, h) {
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = "rgba(8, 18, 52, 0.98)";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;

  for (let i = 1; i < 5; i++) {
    const y = (h / 5) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawSingleLine(history, color, w, h) {
  if (!history || history.length < 2) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();

  const minDb = 35;
  const maxDb = 85;

  for (let i = 0; i < history.length; i++) {
    const x = (i / (maxPoints - 1)) * w;

    let normalized = (history[i] - minDb) / (maxDb - minDb);
    normalized = Math.max(0, Math.min(1, normalized));

    const y = h - normalized * (h - 20) - 10;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
}

function drawGraph() {
  const w = canvas.width;
  const h = canvas.height;

  drawGrid(w, h);

  drawSingleLine(soundHistory.sona1, "#9FD0FF", w, h);
  drawSingleLine(soundHistory.sona2, "#A8FFB0", w, h);
  drawSingleLine(soundHistory.sona3, "#FFB3D9", w, h);
}

function parseTimestamp(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isFiniteMetric(value) {
  return Number.isFinite(Number(value));
}

function getSensorUpdatedAt(sensor) {
  if (!sensor || !sensor.timestamp) return 0;
  const parsed = parseTimestamp(sensor.timestamp);
  return parsed ? parsed.getTime() : 0;
}

function isLiveTimestamp(updatedAt) {
  return updatedAt > 0 && Date.now() - updatedAt < SENSOR_LIVE_WINDOW_MS;
}

function hasUsableSensorData(sensor) {
  if (!sensor) return false;

  const sound = Number(sensor.sound_db);
  const distance = Number(sensor.distance_cm);
  const updatedAt = getSensorUpdatedAt(sensor);

  return Number.isFinite(sound)
    && Number.isFinite(distance)
    && distance >= 0
    && updatedAt > 0;
}

function isValidSensorData(sensor) {
  if (!hasUsableSensorData(sensor)) return false;
  return isLiveTimestamp(getSensorUpdatedAt(sensor));
}

function setMetricValue(element, text, isMissing) {
  if (!element) return;
  element.textContent = text;
  element.classList.toggle("muted", Boolean(isMissing));
}

function normalizeDbValue(db, minDb = HEATMAP_DB_MIN, maxDb = HEATMAP_DB_MAX) {
  if (!Number.isFinite(db)) return null;
  const normalized = (db - minDb) / (maxDb - minDb);
  return Math.max(0, Math.min(1, normalized));
}

function calculateHeatValueAtPoint(x, y, sensors, power = HEATMAP_IDW_POWER) {
  const activeSensors = (sensors || []).filter((sensor) => sensor.active && Number.isFinite(sensor.db));
  if (!activeSensors.length) return null;

  let weightedHeat = 0;
  let weightSum = 0;
  let strongestWeight = 0;

  for (const sensor of activeSensors) {
    const distance = Math.max(Math.hypot(x - sensor.x, y - sensor.y), 1);
    const weight = 1 / (distance ** power);
    const normalizedDb = normalizeDbValue(sensor.db);
    if (normalizedDb == null) continue;

    weightedHeat += normalizedDb * weight;
    weightSum += weight;
    strongestWeight = Math.max(strongestWeight, weight);
  }

  if (!weightSum) return null;

  const blendedHeat = weightedHeat / weightSum;
  const proximity = Math.max(0, Math.min(1, strongestWeight * 28));
  return blendedHeat * proximity;
}

function interpolateColor(start, end, amount) {
  return start.map((channel, index) => channel + (end[index] - channel) * amount);
}

function getHeatmapColor(heatValue) {
  const clamped = Math.max(0, Math.min(1, heatValue));
  const stops = [
    { at: 0.0, color: [76, 143, 255] },
    { at: 0.35, color: [87, 214, 209] },
    { at: 0.58, color: [244, 211, 94] },
    { at: 0.78, color: [255, 152, 72] },
    { at: 1.0, color: [255, 94, 94] }
  ];

  for (let index = 1; index < stops.length; index++) {
    if (clamped <= stops[index].at) {
      const previous = stops[index - 1];
      const current = stops[index];
      const range = current.at - previous.at || 1;
      const amount = (clamped - previous.at) / range;
      const [red, green, blue] = interpolateColor(previous.color, current.color, amount);
      const alpha = 0.10 + clamped * 0.55;
      return `rgba(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)}, ${alpha.toFixed(3)})`;
    }
  }

  return "rgba(255, 94, 94, 0.65)";
}

function buildHeatmapSensors(data) {
  return sensorIds.map((sensorId) => {
    const layout = HEATMAP_SENSOR_LAYOUT[sensorId];
    const sensor = data ? data[sensorId] : null;
    const marker = document.getElementById(`heatmap${sensorId.charAt(0).toUpperCase()}${sensorId.slice(1)}Marker`);
    const active = isValidSensorData(sensor);
    const db = active ? Number(sensor.sound_db) : null;

    if (marker) {
      marker.classList.toggle("active", active);
      marker.classList.toggle("inactive", !active);
      marker.title = active ? `${layout.label}: ${db.toFixed(1)} dB` : `${layout.label}: No data`;
    }

    return {
      id: sensorId,
      label: layout.label,
      x: layout.x,
      y: layout.y,
      db,
      active
    };
  });
}

function renderDashboardHeatmap(data) {
  if (!heatmapCanvas || !heatmapCtx) return;

  resizeHeatmapCanvas();

  const width = heatmapCanvas.getBoundingClientRect().width;
  const height = heatmapCanvas.getBoundingClientRect().height;
  heatmapCtx.clearRect(0, 0, width, height);

  const sensors = buildHeatmapSensors(data);
  const activeSensors = sensors.filter((sensor) => sensor.active);
  if (!activeSensors.length) return;

  const cellSize = 4;
  for (let py = 0; py < height; py += cellSize) {
    for (let px = 0; px < width; px += cellSize) {
      const normalizedX = (px / width) * 100;
      const normalizedY = (py / height) * 100;
      const heatValue = calculateHeatValueAtPoint(normalizedX, normalizedY, sensors);
      if (heatValue == null || heatValue <= 0.01) continue;

      heatmapCtx.fillStyle = getHeatmapColor(heatValue);
      heatmapCtx.fillRect(px, py, cellSize, cellSize);
    }
  }
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildMinuteAverages(rows) {
  const now = Date.now();
  const cutoff = now - DASHBOARD_WINDOW_MS;
  const groups = {
    sona1: { sound: [], distance: [], latestAt: 0 },
    sona2: { sound: [], distance: [], latestAt: 0 },
    sona3: { sound: [], distance: [], latestAt: 0 }
  };

  for (const row of rows) {
    if (!row || !sensorIds.includes(row.sensor_id)) continue;

    const stamp = parseTimestamp(row.timestamp);
    if (!stamp) continue;

    const ts = stamp.getTime();
    if (ts < cutoff) continue;

    const sound = Number(row.sound_db);
    const distance = Number(row.distance_cm);

    if (!Number.isNaN(sound)) groups[row.sensor_id].sound.push(sound);
    if (!Number.isNaN(distance) && distance >= 0) groups[row.sensor_id].distance.push(distance);

    if (ts > groups[row.sensor_id].latestAt) {
      groups[row.sensor_id].latestAt = ts;
    }
  }

  return {
    sona1: {
      sound: average(groups.sona1.sound),
      distance: average(groups.sona1.distance),
      updatedAt: groups.sona1.latestAt
    },
    sona2: {
      sound: average(groups.sona2.sound),
      distance: average(groups.sona2.distance),
      updatedAt: groups.sona2.latestAt
    },
    sona3: {
      sound: average(groups.sona3.sound),
      distance: average(groups.sona3.distance),
      updatedAt: groups.sona3.latestAt
    }
  };
}

function findLatestDirection(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (!row || !row.direction_label) continue;

    const stamp = parseTimestamp(row.timestamp);
    const updatedAt = stamp ? stamp.getTime() : 0;

    return {
      label: row.direction_label,
      angle_deg: Number(row.direction_angle_deg),
      confidence: Number(row.direction_confidence),
      strongest_sensor: row.strongest_sensor || null,
      estimated_distance_cm: Number(row.estimated_direction_distance_cm),
      updatedAt
    };
  }

  return null;
}

function setStatus(box, state, fallbackText = "NO DATA") {
  if (!box) return;

  box.classList.remove("quiet", "medium", "loud", "error");

  if (state === "quiet") {
    box.textContent = "QUIET";
    box.classList.add("quiet");
  } else if (state === "medium") {
    box.textContent = "MEDIUM";
    box.classList.add("medium");
  } else if (state === "loud") {
    box.textContent = "LOUD";
    box.classList.add("loud");
  } else {
    box.textContent = fallbackText;
    box.classList.add("error");
  }
}

function getSoundState(sound) {
  if (sound >= 70) return "loud";
  if (sound >= 50) return "medium";
  return "quiet";
}

function updateCardClasses(card, isActive, isLive) {
  if (!card) return;

  card.classList.remove("active-card", "live-card", "placeholder-card");

  if (isActive) {
    card.classList.add("active-card");
  } else if (isLive) {
    card.classList.add("live-card");
  } else {
    card.classList.add("placeholder-card");
  }
}

function updateBadge(badgeEl, isActive, isLive) {
  if (!badgeEl) return;

  badgeEl.classList.remove("online", "offline");

  if (isActive) {
    badgeEl.textContent = "Live";
    badgeEl.classList.add("online");
  } else if (isLive) {
    badgeEl.textContent = "Ready";
    badgeEl.classList.add("online");
  } else {
    badgeEl.textContent = "Offline";
    badgeEl.classList.add("offline");
  }
}

function updateSensorCard(sensorId, sensorData, isActive, sensorNumber) {
  const cardEl = document.getElementById(`${sensorId}Card`);
  const titleEl = document.getElementById(`${sensorId}Title`);
  const badgeEl = document.getElementById(`${sensorId}Badge`);
  const soundEl = document.getElementById(`${sensorId}Sound`);
  const distanceEl = document.getElementById(`${sensorId}Distance`);
  const statusEl = document.getElementById(`${sensorId}Status`);

  if (!hasUsableSensorData(sensorData)) {
    if (titleEl) titleEl.textContent = `Sensor ${sensorNumber}`;
    setMetricValue(soundEl, "--", true);
    setMetricValue(distanceEl, "-- cm", true);
    setStatus(statusEl, null, "NO DATA");
    soundHistory[sensorId] = [];
    updateBadge(badgeEl, false, false);
    updateCardClasses(cardEl, false);
    return;
  }

  const sound = Number(sensorData.sound_db);
  const distance = Number(sensorData.distance_cm);
  const updatedAt = getSensorUpdatedAt(sensorData);
  const isLive = isLiveTimestamp(updatedAt);

  if (titleEl) {
    titleEl.textContent = isActive
      ? `Sensor ${sensorNumber} — Active`
      : `Sensor ${sensorNumber}`;
  }

  setMetricValue(soundEl, `${sound.toFixed(1)} dB`, false);
  setMetricValue(distanceEl, `${distance.toFixed(1)} cm`, false);

  if (isLive) {
    // Use state from sensor only if it's a recognized value, otherwise derive from dB
    const knownStates = ["quiet", "medium", "loud"];
    const resolvedState = knownStates.includes(sensorData.state)
      ? sensorData.state
      : getSoundState(sound);
    setStatus(statusEl, resolvedState, "NO DATA");

    soundHistory[sensorId].push(sound);
    if (soundHistory[sensorId].length > maxPoints) {
      soundHistory[sensorId].shift();
    }
  } else {
    setStatus(statusEl, null, "STALE");
  }

  updateBadge(badgeEl, isActive, isLive);
  updateCardClasses(cardEl, isActive, isLive);
}

function findLoudestSensor(data) {
  let loudestId = null;
  let loudestValue = -Infinity;

  for (const id of sensorIds) {
    const sensor = data[id];
    if (!isValidSensorData(sensor)) continue;

    const sound = Number(sensor.sound_db);

    if (sound > loudestValue) {
      loudestValue = sound;
      loudestId = id;
    }
  }

  return loudestId;
}

function dbToWeight(db, minDb = HEATMAP_DB_MIN, maxDb = HEATMAP_DB_MAX) {
  if (!Number.isFinite(db)) return 0;
  // Normalize dB to 0-1 range, then use as weight
  // Louder sounds get higher weight
  const normalized = (db - minDb) / (maxDb - minDb);
  const clamped = Math.max(0, Math.min(1, normalized));
  // Use exponential scaling so louder sensors have more influence
  return clamped * clamped;
}

function angleToCompassDirection(angleDeg) {
  // Normalize to 0-360 range
  let normalized = angleDeg % 360;
  if (normalized < 0) normalized += 360;

  // Map to 16-point compass (or 8-point for simplicity)
  // 0° = Right, 90° = Back, 180° = Left, 270° = Front
  // Using 8 cardinal/intercardinal directions
  const directions = [
    "Right",           // 0-22.5°
    "Back Right",      // 22.5-67.5°
    "Back",            // 67.5-112.5°
    "Back Left",       // 112.5-157.5°
    "Left",            // 157.5-202.5°
    "Front Left",      // 202.5-247.5°
    "Front",           // 247.5-292.5°
    "Front Right"      // 292.5-337.5°
  ];

  const index = Math.round(normalized / 45) % 8;
  return directions[index];
}

function calculateWeightedDirection(sensorCache) {
  // Collect all valid sensors
  const validSensors = [];
  
  for (const sensorId of sensorIds) {
    const sensor = sensorCache[sensorId];
    if (!isValidSensorData(sensor)) continue;

    const layout = HEATMAP_SENSOR_LAYOUT[sensorId];
    const db = Number(sensor.sound_db);
    const distance = Number(sensor.distance_cm);
    const weight = dbToWeight(db);

    validSensors.push({
      sensorId,
      x: layout.x,
      y: layout.y,
      db,
      distance,
      weight
    });
  }

  // If fewer than 2 sensors, return "Not enough sensors"
  if (validSensors.length < 2) {
    return {
      label: "Not enough sensors",
      angle_deg: null,
      confidence: "Low",
      estimated_distance_cm: null,
      updatedAt: 0
    };
  }

  // Calculate weighted center
  let weightedX = 0;
  let weightedY = 0;
  let weightedDistance = 0;
  let totalWeight = 0;

  for (const sensor of validSensors) {
    weightedX += sensor.x * sensor.weight;
    weightedY += sensor.y * sensor.weight;
    weightedDistance += sensor.distance * sensor.weight;
    totalWeight += sensor.weight;
  }

  if (totalWeight === 0) {
    return {
      label: "Not enough sensors",
      angle_deg: null,
      confidence: "Low",
      estimated_distance_cm: null,
      updatedAt: 0
    };
  }

  weightedX /= totalWeight;
  weightedY /= totalWeight;
  weightedDistance /= totalWeight;

  // Calculate angle from room center (50, 50) to weighted center
  const centerX = 50;
  const centerY = 50;
  const angleDeg = Math.atan2(weightedY - centerY, weightedX - centerX) * 180 / Math.PI;

  // Map angle to compass direction
  const compassDirection = angleToCompassDirection(angleDeg);

  // Calculate confidence based on number of sensors and dB variance
  let confidence = "Low";
  if (validSensors.length === 2) {
    confidence = "Medium";
  } else if (validSensors.length === 3) {
    // Calculate standard deviation of dB values
    const avgDb = validSensors.reduce((sum, s) => sum + s.db, 0) / validSensors.length;
    const variance = validSensors.reduce((sum, s) => sum + Math.pow(s.db - avgDb, 2), 0) / validSensors.length;
    const stdDev = Math.sqrt(variance);

    // More consistent readings (lower variance) = higher confidence
    if (stdDev < 5) {
      confidence = "High";
    } else {
      confidence = "Medium";
    }
  }

  // Get latest timestamp from valid sensors
  let latestTimestamp = 0;
  for (const sensor of validSensors) {
    const sensorObj = sensorCache[sensor.sensorId];
    const ts = getSensorUpdatedAt(sensorObj);
    latestTimestamp = Math.max(latestTimestamp, ts);
  }

  return {
    label: compassDirection,
    angle_deg: angleDeg,
    confidence: confidence,
    estimated_distance_cm: Number.isFinite(weightedDistance) ? weightedDistance : null,
    updatedAt: latestTimestamp
  };
}

function prettyDirectionLabel(label) {
  if (!label || label === "UNKNOWN") return "Unknown";
  return String(label)
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function updateDirectionCard(directionData) {
  const badgeEl = document.getElementById("directionBadge");
  const labelEl = document.getElementById("directionLabel");
  const angleEl = document.getElementById("directionAngle");
  const confidenceEl = document.getElementById("directionConfidence");
  const distanceEl = document.getElementById("directionDistance");

  const updatedAt = Number(directionData && directionData.updatedAt ? directionData.updatedAt : 0);
  const isLive = isLiveTimestamp(updatedAt);

  if (!directionData || !isLive) {
    setMetricValue(labelEl, "No data", true);
    setMetricValue(angleEl, "--", true);
    setMetricValue(confidenceEl, "--", true);
    setMetricValue(distanceEl, "-- cm", true);
    updateBadge(badgeEl, false, false);
    return;
  }

  const angle = directionData.angle_deg != null ? Number(directionData.angle_deg) : NaN;
  const confidence = directionData.confidence;
  const estimatedDistance = directionData.estimated_distance_cm != null ? Number(directionData.estimated_distance_cm) : NaN;

  setMetricValue(labelEl, prettyDirectionLabel(directionData.label), false);
  setMetricValue(angleEl, Number.isFinite(angle) ? `${angle.toFixed(1)} deg` : "--", !Number.isFinite(angle));
  
  // Handle both numeric and string confidence values
  let confidenceText = "--";
  let hasConfidence = false;
  if (typeof confidence === "string" && confidence) {
    confidenceText = confidence;
    hasConfidence = true;
  } else if (Number.isFinite(confidence)) {
    confidenceText = `${Math.round(confidence * 100)}%`;
    hasConfidence = true;
  }
  setMetricValue(confidenceEl, confidenceText, !hasConfidence);
  
  setMetricValue(
    distanceEl,
    Number.isFinite(estimatedDistance) ? `${estimatedDistance.toFixed(1)} cm` : "-- cm",
    !Number.isFinite(estimatedDistance)
  );

  updateBadge(badgeEl, true, true);
}

function renderDashboardFromCache() {
  const activeSensorId = findLoudestSensor(sensorCache);
  updateSensorCard("sona1", sensorCache.sona1, activeSensorId === "sona1", 1);
  updateSensorCard("sona2", sensorCache.sona2, activeSensorId === "sona2", 2);
  updateSensorCard("sona3", sensorCache.sona3, activeSensorId === "sona3", 3);

  // Direction estimate uses the latest cache snapshot across sensors.
  const directionData = calculateWeightedDirection(sensorCache);
  updateDirectionCard(directionData);

  renderDashboardHeatmap(sensorCache);
  drawGraph();
}

const S3_LATEST_URL = "https://sona-data-kelly.s3.amazonaws.com/latest.json";

async function loadLiveData() {
  if (isAwsFetchInProgress) {
    console.log("[SONA] AWS fetch skipped: previous fetch still running");
    return;
  }

  // Only one tab fetches at a time; all others sync via the storage event.
  if (!claimFetchLeadership()) {
    console.log("[SONA] AWS fetch deferred: another tab is fetch leader — syncing from shared cache");
    const fresh = loadSensorCache();
    for (const id of sensorIds) sensorCache[id] = fresh[id];
    renderDashboardFromCache();
    return;
  }

  isAwsFetchInProgress = true;
  try {
    console.log(`[SONA] AWS fetch started at ${new Date().toISOString()}`);

    const response = await fetch(S3_LATEST_URL + "?t=" + Date.now()); // cache-bust
    if (!response.ok) throw new Error(`Live fetch failed with status ${response.status}`);
    const payload = await response.json();

    // Normalise S3 payload into { sona1: {...}, sona2: {...}, sona3: {...} }
    // Handles: flat single object, array of objects, or already-keyed map
    let incoming = {};
    if (Array.isArray(payload)) {
      for (const row of payload) {
        if (row && row.sensor_id) {
          if (row.sound_state && !row.state) row.state = row.sound_state;
          incoming[row.sensor_id] = row;
        }
      }
    } else if (payload && payload.sensor_id) {
      // Flat single object — Lambda wrote latest reading for one sensor
      if (payload.sound_state && !payload.state) payload.state = payload.sound_state;
      incoming[payload.sensor_id] = payload;
    } else {
      for (const [key, row] of Object.entries(payload || {})) {
        if (row && row.sound_state && !row.state) row.state = row.sound_state;
        incoming[key] = row;
      }
    }

    // Merge payload into cache so sensors not present in this response keep
    // their last known value until the next shared poll.
    const newRows = [];
    const updatedSensors = [];
    for (const id of sensorIds) {
      const nextSensor = incoming[id];
      if (!nextSensor) continue;

      if (!hasUsableSensorData(nextSensor)) {
        console.warn(`[SONA] Ignoring malformed payload for ${id}`, nextSensor);
        continue;
      }

      sensorCache[id] = nextSensor;
      newRows.push(nextSensor);
      updatedSensors.push(id);
    }

    saveSensorCache(sensorCache);
    if (newRows.length) appendToHistory(newRows);

    console.log(
      `[SONA] AWS fetch complete. Updated sensors: ${updatedSensors.length ? updatedSensors.join(", ") : "none"}`
    );
    for (const id of sensorIds) {
      const sensor = sensorCache[id];
      const updatedAt = getSensorUpdatedAt(sensor);
      const stampText = updatedAt ? new Date(updatedAt).toISOString() : "N/A";
      const stateText = isValidSensorData(sensor) ? "LIVE" : "OFFLINE";
      console.log(`[SONA] ${id}: timestamp=${stampText}, state=${stateText}`);
    }

    renderDashboardFromCache();
  } catch (error) {
    console.error("[SONA] Failed to load live data:", error);
    // Keep rendering from cache on transient network failures.
    renderDashboardFromCache();
  } finally {
    isAwsFetchInProgress = false;
    // Release leadership so this tab can claim it again on the next cycle.
    try { localStorage.removeItem(FETCH_LEADER_KEY); } catch { /* ignore */ }
  }
}

resizeCanvas();
resizeHeatmapCanvas();

// Render whatever is in the cache immediately so UI isn't blank on navigation
(function renderCachedImmediately() {
  renderDashboardFromCache();
})();

window.addEventListener("resize", () => {
  resizeCanvas();
  resizeHeatmapCanvas();
  renderDashboardHeatmap(sensorCache);
  drawGraph();
});

// When any other tab writes sensorCache to localStorage, re-render immediately
// so all windows always show the same data without needing their own AWS fetch.
window.addEventListener("storage", (event) => {
  if (event.key !== CACHE_KEY || !event.newValue) return;
  try {
    const updated = JSON.parse(event.newValue);
    for (const id of sensorIds) sensorCache[id] = updated[id] ?? sensorCache[id];
    console.log("[SONA] Cross-tab cache update received — re-rendering");
    renderDashboardFromCache();
  } catch { /* ignore malformed */ }
});

setInterval(loadLiveData, DASHBOARD_REFRESH_MS);
bootstrapHistory();
loadLiveData();
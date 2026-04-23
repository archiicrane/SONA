const soundHistory = {
  sona1: [],
  sona2: [],
  sona3: []
};

const CACHE_KEY = "sona_sensor_cache";
const HISTORY_KEY = "sona_history";
const MAX_HISTORY = 2000;

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
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const history = raw ? JSON.parse(raw) : [];
    const existingKeys = new Set(history.map((r) => `${r.sensor_id}|${r.timestamp}`));
    for (const row of incoming) {
      const key = `${row.sensor_id}|${row.timestamp}`;
      if (!existingKeys.has(key)) { history.push(row); existingKeys.add(key); }
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  } catch { /* ignore */ }
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
const DASHBOARD_REFRESH_MS = 3 * 1000;
const SENSOR_LIVE_WINDOW_MS = 2 * 60 * 1000;

const canvas = document.getElementById("waveCanvas");
const ctx = canvas.getContext("2d");

function goToSensor(sensorId) {
  window.location.href = `/history.html?sensor=${sensorId}`;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
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

  if (!sensorData) {
    if (titleEl) titleEl.textContent = `Sensor ${sensorNumber}`;
    if (soundEl) soundEl.textContent = "--";
    if (distanceEl) distanceEl.textContent = "--";
    setStatus(statusEl, null, "NO DATA");
    updateBadge(badgeEl, false, false);
    updateCardClasses(cardEl, false);
    return;
  }

  const sound = Number(sensorData.sound_db);
  const distance = Number(sensorData.distance_cm);
  const ts = sensorData.timestamp;
  const updatedAt = ts ? new Date(ts).getTime() : 0;
  const age = Date.now() - updatedAt;
  const isLive = updatedAt > 0 && age < SENSOR_LIVE_WINDOW_MS;

  if (titleEl) {
    titleEl.textContent = isActive
      ? `Sensor ${sensorNumber} — Active`
      : `Sensor ${sensorNumber}`;
  }

  if (soundEl) {
    soundEl.textContent = !Number.isNaN(sound) ? `${sound.toFixed(1)} dB` : "--";
  }

  if (distanceEl) {
    distanceEl.textContent =
      !Number.isNaN(distance) && distance >= 0 ? `${distance.toFixed(1)} cm` : "--";
  }

  if (!Number.isNaN(sound) && isLive) {
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
    setStatus(statusEl, null, "NO DATA");
  }

  updateBadge(badgeEl, isActive, isLive);
  updateCardClasses(cardEl, isActive, isLive);
}

function findLoudestSensor(data) {
  let loudestId = null;
  let loudestValue = -Infinity;

  for (const id of sensorIds) {
    const sensor = data[id];
    if (!sensor) continue;

    const sound = Number(sensor.sound_db);
    const updatedAt = sensor.timestamp ? new Date(sensor.timestamp).getTime() : 0;
    const age = Date.now() - updatedAt;

    if (age > SENSOR_LIVE_WINDOW_MS) continue;
    if (Number.isNaN(sound)) continue;

    if (sound > loudestValue) {
      loudestValue = sound;
      loudestId = id;
    }
  }

  return loudestId;
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
  const isLive = updatedAt > 0 && Date.now() - updatedAt < SENSOR_LIVE_WINDOW_MS;

  if (!directionData || !isLive) {
    if (labelEl) labelEl.textContent = "--";
    if (angleEl) angleEl.textContent = "--";
    if (confidenceEl) confidenceEl.textContent = "--";
    if (distanceEl) distanceEl.textContent = "--";
    updateBadge(badgeEl, false, false);
    return;
  }

  const angle = Number(directionData.angle_deg);
  const confidence = Number(directionData.confidence);
  const estimatedDistance = Number(directionData.estimated_distance_cm);

  if (labelEl) labelEl.textContent = prettyDirectionLabel(directionData.label);
  if (angleEl) angleEl.textContent = Number.isFinite(angle) ? `${angle.toFixed(1)} deg` : "--";
  if (confidenceEl) {
    confidenceEl.textContent = Number.isFinite(confidence)
      ? `${Math.round(confidence * 100)}%`
      : "--";
  }
  if (distanceEl) {
    distanceEl.textContent = Number.isFinite(estimatedDistance)
      ? `${estimatedDistance.toFixed(1)} cm`
      : "--";
  }

  updateBadge(badgeEl, true, true);
}

const S3_LATEST_URL = "https://sona-data-kelly.s3.amazonaws.com/latest.json";

async function loadLiveData() {
  try {
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

    // Merge into cache — only update sensors that arrived in this fetch
    const newRows = [];
    for (const id of sensorIds) {
      if (incoming[id]) {
        sensorCache[id] = incoming[id];
        newRows.push(incoming[id]);
      }
    }
    saveSensorCache(sensorCache);
    if (newRows.length) appendToHistory(newRows);

    const activeSensorId = findLoudestSensor(sensorCache);
    updateSensorCard("sona1", sensorCache.sona1, activeSensorId === "sona1", 1);
    updateSensorCard("sona2", sensorCache.sona2, activeSensorId === "sona2", 2);
    updateSensorCard("sona3", sensorCache.sona3, activeSensorId === "sona3", 3);

    // Derive direction from loudest active sensor
    if (activeSensorId && sensorCache[activeSensorId]) {
      const activeSensor = sensorCache[activeSensorId];
      const sensorNumber = { sona1: 1, sona2: 2, sona3: 3 }[activeSensorId];
      updateDirectionCard({
        label: `Sensor ${sensorNumber}`,
        angle_deg: null,
        confidence: null,
        estimated_distance_cm: Number(activeSensor.distance_cm),
        updatedAt: activeSensor.timestamp ? new Date(activeSensor.timestamp).getTime() : 0
      });
    } else {
      updateDirectionCard(null);
    }

    drawGraph();
  } catch (error) {
    console.error("[SONA] Failed to load live data:", error);
    updateSensorCard("sona1", null, false, 1);
    updateSensorCard("sona2", null, false, 2);
    updateSensorCard("sona3", null, false, 3);
    drawGraph();
  }
}

resizeCanvas();

// Render whatever is in the cache immediately so UI isn't blank on navigation
(function renderCachedImmediately() {
  const activeSensorId = findLoudestSensor(sensorCache);
  updateSensorCard("sona1", sensorCache.sona1, activeSensorId === "sona1", 1);
  updateSensorCard("sona2", sensorCache.sona2, activeSensorId === "sona2", 2);
  updateSensorCard("sona3", sensorCache.sona3, activeSensorId === "sona3", 3);
  drawGraph();
})();

window.addEventListener("resize", () => {
  resizeCanvas();
  drawGraph();
});

setInterval(loadLiveData, DASHBOARD_REFRESH_MS);
loadLiveData();
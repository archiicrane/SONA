const fs = require("fs");
const path = require("path");
const querystring = require("querystring");

const SENSOR_IDS = ["sona1", "sona2", "sona3"];
const MAX_RECORDS = 5000;
const LIVE_WINDOW_MS = 6000;
const runningOnVercel = Boolean(process.env.VERCEL);
const DATA_FILE = runningOnVercel
  ? path.join("/tmp", "sona-data.json")
  : path.join(process.cwd(), "data.json");

const SENSOR_LAYOUT = {
  sona1: { x: -1.0, y: 0.0 },
  sona2: { x: 1.0, y: 0.0 },
  sona3: { x: 0.0, y: 1.25 }
};

let historyMemory = [];
let latestData = createEmptyLatestData();

function createEmptyLatestData() {
  return {
    sona1: { sound: 0, distance: 0, updatedAt: 0 },
    sona2: { sound: 0, distance: 0, updatedAt: 0 },
    sona3: { sound: 0, distance: 0, updatedAt: 0 },
    _direction: {
      label: "UNKNOWN",
      angle_deg: null,
      confidence: 0,
      strongest_sensor: null,
      estimated_distance_cm: null,
      updatedAt: 0
    }
  };
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function soundToState(sound) {
  if (sound >= 70) return "loud";
  if (sound >= 50) return "medium";
  return "quiet";
}

function canonicalSensorId(sensorId) {
  const key = String(sensorId || "").trim().toLowerCase();
  return SENSOR_IDS.includes(key) ? key : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function angleToDirectionLabel(angleDeg) {
  const normalized = ((angleDeg % 360) + 360) % 360;
  const sectors = [
    { label: "RIGHT", center: 0 },
    { label: "FRONT_RIGHT", center: 45 },
    { label: "FRONT", center: 90 },
    { label: "FRONT_LEFT", center: 135 },
    { label: "LEFT", center: 180 },
    { label: "BACK_LEFT", center: 225 },
    { label: "BACK", center: 270 },
    { label: "BACK_RIGHT", center: 315 }
  ];

  let best = sectors[0];
  let bestDistance = Infinity;

  for (const sector of sectors) {
    const delta = Math.abs((((normalized - sector.center) % 360) + 540) % 360 - 180);
    if (delta < bestDistance) {
      bestDistance = delta;
      best = sector;
    }
  }

  return best.label;
}

function inferDirectionFromLatest(now = Date.now()) {
  const weightedSensors = [];

  for (const sensorId of SENSOR_IDS) {
    const sensor = latestData[sensorId];
    if (!sensor) continue;

    const updatedAt = Number(sensor.updatedAt || 0);
    if (!updatedAt || now - updatedAt > LIVE_WINDOW_MS) continue;

    const sound = toNumber(sensor.sound);
    const distance = toNumber(sensor.distance);
    if (sound == null) continue;

    const normalizedSound = clamp((sound - 30) / 70, 0, 1);
    const safeDistance = distance == null || distance < 0 ? null : distance;
    const distanceFactor = safeDistance == null ? 1 : 1 / (1 + safeDistance / 120);
    const weight = normalizedSound * distanceFactor;

    if (weight <= 0) continue;

    weightedSensors.push({
      id: sensorId,
      weight,
      sound,
      distance: safeDistance
    });
  }

  if (!weightedSensors.length) {
    return {
      label: "UNKNOWN",
      angle_deg: null,
      confidence: 0,
      strongest_sensor: null,
      estimated_distance_cm: null,
      updatedAt: now
    };
  }

  weightedSensors.sort((a, b) => b.weight - a.weight);
  const strongest = weightedSensors[0];

  const totalWeight = weightedSensors.reduce((sum, sensor) => sum + sensor.weight, 0);
  if (totalWeight <= 0) {
    return {
      label: "UNKNOWN",
      angle_deg: null,
      confidence: 0,
      strongest_sensor: strongest.id,
      estimated_distance_cm: strongest.distance,
      updatedAt: now
    };
  }

  let x = 0;
  let y = 0;
  let weightedDistance = 0;
  let distanceWeight = 0;

  for (const sensor of weightedSensors) {
    const point = SENSOR_LAYOUT[sensor.id];
    x += point.x * sensor.weight;
    y += point.y * sensor.weight;

    if (sensor.distance != null) {
      weightedDistance += sensor.distance * sensor.weight;
      distanceWeight += sensor.weight;
    }
  }

  const angleDeg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const top2Delta = weightedSensors.length > 1
    ? (weightedSensors[0].weight - weightedSensors[1].weight) / weightedSensors[0].weight
    : 1;
  const sensorCoverage = clamp(weightedSensors.length / SENSOR_IDS.length, 0, 1);
  const confidence = clamp(top2Delta * 0.7 + sensorCoverage * 0.3, 0, 1);

  return {
    label: angleToDirectionLabel(angleDeg),
    angle_deg: Number(angleDeg.toFixed(1)),
    confidence: Number(confidence.toFixed(2)),
    strongest_sensor: strongest.id,
    estimated_distance_cm: distanceWeight > 0 ? Number((weightedDistance / distanceWeight).toFixed(1)) : null,
    updatedAt: now
  };
}

function ensureDataFile() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, "[]", "utf8");
    }
    console.log(`[SONA] Storage ready (${runningOnVercel ? "vercel-tmp" : "local-file"}): ${DATA_FILE}`);
    return true;
  } catch (error) {
    console.warn("[SONA] data.json not writable, falling back to in-memory history:", error.message);
    return false;
  }
}

const canUseFileStorage = ensureDataFile();

function coerceHistoryRow(row) {
  if (!row || typeof row !== "object") return null;

  const sensor = canonicalSensorId(row.sensor) || "sona1";
  const sound = toNumber(row.sound);
  const distance = toNumber(row.distance_cm ?? row.distance);

  if (sound == null && distance == null) return null;

  const timestamp = new Date(row.timestamp || Date.now()).toISOString();
  const safeSound = sound ?? 0;

  return {
    sensor,
    timestamp,
    sound: safeSound,
    distance_cm: distance ?? 0,
    sound_state: row.sound_state || soundToState(safeSound),
    direction_label: typeof row.direction_label === "string" ? row.direction_label : undefined,
    direction_angle_deg: toNumber(row.direction_angle_deg),
    direction_confidence: toNumber(row.direction_confidence),
    strongest_sensor: canonicalSensorId(row.strongest_sensor) || undefined,
    estimated_direction_distance_cm: toNumber(row.estimated_direction_distance_cm)
  };
}

function readFileHistory() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(coerceHistoryRow).filter(Boolean);
  } catch (error) {
    console.error("[SONA] Failed reading data.json:", error.message);
    return [];
  }
}

function writeFileHistory(rows) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2), "utf8");
    return true;
  } catch (error) {
    console.error("[SONA] Failed writing data.json:", error.message);
    return false;
  }
}

function readHistory() {
  if (!canUseFileStorage) return historyMemory;
  const rows = readFileHistory();
  historyMemory = rows;
  return rows;
}

function writeHistory(rows) {
  const trimmed = rows.slice(-MAX_RECORDS);
  historyMemory = trimmed;

  if (!canUseFileStorage) return;
  writeFileHistory(trimmed);
}

function normalizeSensorRecord(sensor, payload, timestamp) {
  const sensorId = canonicalSensorId(sensor);
  if (!sensorId) return null;
  if (!payload || typeof payload !== "object") return null;

  const sound = toNumber(payload.sound);
  const distance = toNumber(payload.distance ?? payload.distance_cm);

  if (sound == null && distance == null) return null;

  const safeSound = sound ?? 0;

  return {
    sensor: sensorId,
    timestamp,
    sound: safeSound,
    distance_cm: distance ?? 0,
    sound_state: soundToState(safeSound)
  };
}

function normalizeIncomingPayload(body) {
  const payload = coerceRequestBody(body);
  const timestamp = new Date().toISOString();
  const entries = [];

  if (payload && typeof payload === "object" && payload.sensor != null) {
    const single = normalizeSensorRecord(payload.sensor, payload, timestamp);
    if (single) {
      entries.push(single);
    } else {
      console.warn("[SONA] Ignored payload with invalid sensor id:", payload.sensor);
    }
    return entries;
  }

  for (const sensor of SENSOR_IDS) {
    const entry = normalizeSensorRecord(sensor, payload && payload[sensor], timestamp);
    if (entry) entries.push(entry);
  }

  return entries;
}

function coerceRequestBody(body) {
  if (body == null) return {};

  if (Buffer.isBuffer(body)) {
    return coerceRequestBody(body.toString("utf8"));
  }

  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return {};

    try {
      return JSON.parse(trimmed);
    } catch {
      // Accept x-www-form-urlencoded style fallbacks from microcontroller posts.
      const parsed = querystring.parse(trimmed);
      return typeof parsed === "object" && parsed ? parsed : {};
    }
  }

  if (typeof body === "object") {
    return body;
  }

  return {};
}

function updateLatestFromEntries(entries) {
  for (const entry of entries) {
    latestData[entry.sensor] = {
      sound: entry.sound,
      distance: entry.distance_cm,
      updatedAt: Date.parse(entry.timestamp) || Date.now()
    };
  }
}

function getLatest() {
  latestData._direction = inferDirectionFromLatest();
  return latestData;
}

function savePayload(body) {
  console.log("[SONA] Incoming payload received for save");
  const entries = normalizeIncomingPayload(body);
  if (!entries.length) {
    console.warn("[SONA] Payload parse failed: no valid sensor entries");
    return { ok: false, error: "No valid sensor payload found" };
  }

  updateLatestFromEntries(entries);
  const direction = inferDirectionFromLatest();
  latestData._direction = direction;

  const stampedEntries = entries.map((entry) => ({
    ...entry,
    direction_label: direction.label,
    direction_angle_deg: direction.angle_deg,
    direction_confidence: direction.confidence,
    strongest_sensor: direction.strongest_sensor,
    estimated_direction_distance_cm: direction.estimated_distance_cm
  }));

  const history = readHistory();
  history.push(...stampedEntries);
  writeHistory(history);

  console.log(`[SONA] Persisted ${stampedEntries.length} reading(s). Total cached rows: ${history.length}`);

  return { ok: true, entries: stampedEntries, direction };
}

function getHistory(options = {}) {
  const sensor = SENSOR_IDS.includes(options.sensor) ? options.sensor : null;
  const order = options.order === "asc" ? "asc" : "desc";
  const rawLimit = toNumber(options.limit);
  const limit = Math.max(1, Math.min(rawLimit || MAX_RECORDS, MAX_RECORDS));

  let rows = readHistory();

  if (sensor) {
    rows = rows.filter((row) => row.sensor === sensor);
  }

  rows = rows.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  if (order === "desc") {
    rows = rows.slice(-limit).reverse();
  } else {
    rows = rows.slice(-limit);
  }

  return {
    rows,
    count: rows.length,
    sensor,
    order
  };
}

function clearHistory() {
  historyMemory = [];
  writeHistory([]);
}

module.exports = {
  SENSOR_IDS,
  getLatest,
  savePayload,
  getHistory,
  clearHistory
};

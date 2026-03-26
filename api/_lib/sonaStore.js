const fs = require("fs");
const path = require("path");

const SENSOR_IDS = ["sona1", "sona2", "sona3"];
const MAX_RECORDS = 5000;
const DATA_FILE = path.join(process.cwd(), "data.json");

let historyMemory = [];
let latestData = createEmptyLatestData();

function createEmptyLatestData() {
  return {
    sona1: { sound: 0, distance: 0, updatedAt: 0 },
    sona2: { sound: 0, distance: 0, updatedAt: 0 },
    sona3: { sound: 0, distance: 0, updatedAt: 0 }
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

function ensureDataFile() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, "[]", "utf8");
    }
    return true;
  } catch (error) {
    console.warn("[SONA] data.json not writable, falling back to in-memory history:", error.message);
    return false;
  }
}

const canUseFileStorage = ensureDataFile();

function coerceHistoryRow(row) {
  if (!row || typeof row !== "object") return null;

  const sensor = SENSOR_IDS.includes(row.sensor) ? row.sensor : "sona1";
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
    sound_state: row.sound_state || soundToState(safeSound)
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
  if (!SENSOR_IDS.includes(sensor)) return null;
  if (!payload || typeof payload !== "object") return null;

  const sound = toNumber(payload.sound);
  const distance = toNumber(payload.distance ?? payload.distance_cm);

  if (sound == null && distance == null) return null;

  const safeSound = sound ?? 0;

  return {
    sensor,
    timestamp,
    sound: safeSound,
    distance_cm: distance ?? 0,
    sound_state: soundToState(safeSound)
  };
}

function normalizeIncomingPayload(body) {
  const timestamp = new Date().toISOString();
  const entries = [];

  if (body && typeof body === "object" && typeof body.sensor === "string") {
    const single = normalizeSensorRecord(body.sensor, body, timestamp);
    if (single) entries.push(single);
    return entries;
  }

  for (const sensor of SENSOR_IDS) {
    const entry = normalizeSensorRecord(sensor, body && body[sensor], timestamp);
    if (entry) entries.push(entry);
  }

  return entries;
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
  return latestData;
}

function savePayload(body) {
  const entries = normalizeIncomingPayload(body);
  if (!entries.length) {
    return { ok: false, error: "No valid sensor payload found" };
  }

  updateLatestFromEntries(entries);

  const history = readHistory();
  history.push(...entries);
  writeHistory(history);

  return { ok: true, entries };
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

const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

// -------------------- CONFIG --------------------
const ARDUINO_URL = "http://192.168.1.76/data";
const DATA_FILE = path.join(__dirname, "data.json");
const MAX_RECORDS = 5000;
const POLL_MS = 2000;
const SENSOR_IDS = ["sona1", "sona2", "sona3"];
// ------------------------------------------------

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]), "utf8");
}

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

let latestArduinoData = {
  sona1: { sound: 0, distance: 0, updatedAt: 0 },
  sona2: { sound: 0, distance: 0, updatedAt: 0 },
  sona3: { sound: 0, distance: 0, updatedAt: 0 }
};

function readSavedData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSavedData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function soundToState(sound) {
  if (sound >= 70) return "loud";
  if (sound >= 50) return "medium";
  return "quiet";
}

function sanitizeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeSensorRecord(sensorId, sensorData, timestamp = new Date().toISOString()) {
  if (!sensorData || typeof sensorData !== "object") return null;

  const sound = sanitizeNumber(sensorData.sound);
  const distance = sanitizeNumber(sensorData.distance ?? sensorData.distance_cm);

  if (sound == null && distance == null) return null;

  return {
    sensor: sensorId,
    timestamp,
    sound: sound ?? 0,
    distance_cm: distance ?? 0,
    sound_state: soundToState(sound ?? 0)
  };
}

function saveHistoryEntries(entries) {
  if (!entries.length) return;

  const saved = readSavedData();
  saved.push(...entries);

  if (saved.length > MAX_RECORDS) {
    saved.splice(0, saved.length - MAX_RECORDS);
  }

  writeSavedData(saved);
}

function updateLatestData(sensorId, entry) {
  latestArduinoData[sensorId] = {
    sound: entry.sound,
    distance: entry.distance_cm,
    updatedAt: Date.parse(entry.timestamp) || Date.now()
  };
}

function normalizeIncomingPayload(body) {
  const timestamp = new Date().toISOString();
  const entries = [];

  if (body && typeof body === "object" && typeof body.sensor === "string") {
    const sensorId = body.sensor;
    const entry = normalizeSensorRecord(sensorId, body, timestamp);
    if (entry) entries.push(entry);
    return entries;
  }

  for (const sensorId of SENSOR_IDS) {
    const entry = normalizeSensorRecord(sensorId, body?.[sensorId], timestamp);
    if (entry) entries.push(entry);
  }

  return entries;
}

app.get("/api/arduino", (req, res) => {
  res.json(latestArduinoData);
});

app.post("/api/arduino", (req, res) => {
  const entries = normalizeIncomingPayload(req.body);

  if (!entries.length) {
    return res.status(400).json({ error: "No valid sensor data received" });
  }

  for (const entry of entries) {
    updateLatestData(entry.sensor, entry);
  }

  saveHistoryEntries(entries);
  console.log("Received Arduino data:", entries);

  res.json({ status: "received", saved: entries.length });
});

app.get("/api/live", async (req, res) => {
  try {
    const response = await fetch(ARDUINO_URL);
    if (!response.ok) {
      return res.status(500).json({ error: "Arduino request failed" });
    }

    const data = await response.json();
    res.json(data);
  } catch {
    res.status(500).json({ error: "Could not reach Arduino" });
  }
});

app.get("/api/history", (req, res) => {
  const sensorFilter = req.query.sensor;
  const limit = Math.max(1, Math.min(Number(req.query.limit) || MAX_RECORDS, MAX_RECORDS));

  let data = readSavedData();

  if (sensorFilter) {
    data = data.filter((row) => row.sensor === sensorFilter);
  }

  data.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  data = data.slice(-limit);

  res.json(data);
});

app.post("/api/clear", (req, res) => {
  writeSavedData([]);
  res.json({ ok: true });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/history", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "history.html"));
});

app.get("/raw", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "raw.html"));
});

async function pollArduinoAndSave() {
  try {
    const response = await fetch(ARDUINO_URL);
    if (!response.ok) return;

    const live = await response.json();
    const entries = normalizeIncomingPayload(live);

    if (!entries.length) return;

    for (const entry of entries) {
      updateLatestData(entry.sensor, entry);
    }

    saveHistoryEntries(entries);
  } catch (err) {
    console.log("Polling error:", err.message);
  }
}

setInterval(pollArduinoAndSave, POLL_MS);
pollArduinoAndSave();

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

// -------------------- CONFIG --------------------
const ARDUINO_URL = "http://192.168.1.76/data";
const DATA_FILE = path.join(__dirname, "data.json");
const MAX_RECORDS = 2000; // keep latest readings
const POLL_MS = 2000;     // save every 2 seconds
// ------------------------------------------------

// create data file if missing
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]), "utf8");
}

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

let latestArduinoData = {
  sound_db: 0,
  distance_cm: 0,
  sound_state: "quiet",
  led: false
};

app.get("/api/arduino", (req, res) => {
  res.json(latestArduinoData);
});

app.post("/api/arduino", (req, res) => {
  latestArduinoData = req.body;
  console.log("Received Arduino data:", latestArduinoData);
  res.json({ status: "received" });
});

function readSavedData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return [];
  }
}

function writeSavedData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

// live proxy from Arduino
app.get("/api/live", async (req, res) => {
  try {
    const response = await fetch(ARDUINO_URL);
    if (!response.ok) {
      return res.status(500).json({ error: "Arduino request failed" });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Could not reach Arduino" });
  }
});

// saved history data
app.get("/api/history", (req, res) => {
  const data = readSavedData();
  res.json(data);
});

// clear saved history if needed
app.post("/api/clear", (req, res) => {
  writeSavedData([]);
  res.json({ ok: true });
});

// routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/history", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "history.html"));
});

app.get("/raw", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "raw.html"));
});

// poll Arduino and save readings
async function pollArduinoAndSave() {
  try {
    const response = await fetch(ARDUINO_URL);
    if (!response.ok) return;

    const live = await response.json();

    const reading = {
      timestamp: new Date().toISOString(),
      sound: live.sound,
      sound_state: live.sound_state,
      distance_cm: live.distance_cm
    };

    const saved = readSavedData();
    saved.push(reading);

    if (saved.length > MAX_RECORDS) {
      saved.splice(0, saved.length - MAX_RECORDS);
    }

    writeSavedData(saved);
  } catch (err) {
    console.log("Polling error:", err.message);
  }
}

setInterval(pollArduinoAndSave, POLL_MS);
pollArduinoAndSave();

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
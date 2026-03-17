const soundHistory = {
  sona1: [],
  sona2: [],
  sona3: []
};

const maxPoints = 120;
const sensorIds = ["sona1", "sona2", "sona3"];

const canvas = document.getElementById("waveCanvas");
const ctx = canvas.getContext("2d");

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

  const sound = Number(sensorData.sound);
  const distance = Number(sensorData.distance);
  const updatedAt = Number(sensorData.updatedAt || 0);
  const age = Date.now() - updatedAt;
  const isLive = age < 6000;

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
    setStatus(statusEl, getSoundState(sound), "WAITING");

    soundHistory[sensorId].push(sound);
    if (soundHistory[sensorId].length > maxPoints) {
      soundHistory[sensorId].shift();
    }
  } else {
    setStatus(statusEl, null, "WAITING");
  }

  updateBadge(badgeEl, isActive, isLive);
  updateCardClasses(cardEl, isActive);
}

function findLoudestSensor(data) {
  let loudestId = null;
  let loudestValue = -Infinity;

  for (const id of sensorIds) {
    const sensor = data[id];
    if (!sensor) continue;

    const sound = Number(sensor.sound);
    const updatedAt = Number(sensor.updatedAt || 0);
    const age = Date.now() - updatedAt;

    if (age > 6000) continue;
    if (Number.isNaN(sound)) continue;

    if (sound > loudestValue) {
      loudestValue = sound;
      loudestId = id;
    }
  }

  return loudestId;
}

async function loadLiveData() {
  try {
    const response = await fetch("/api/arduino");
    if (!response.ok) throw new Error("Live fetch failed");

    const data = await response.json();
    const activeSensorId = findLoudestSensor(data);

    updateSensorCard("sona1", data.sona1, activeSensorId === "sona1", 1);
    updateSensorCard("sona2", data.sona2, activeSensorId === "sona2", 2);
    updateSensorCard("sona3", data.sona3, activeSensorId === "sona3", 3);

    drawGraph();
  } catch (error) {
    updateSensorCard("sona1", null, false, 1);
    updateSensorCard("sona2", null, false, 2);
    updateSensorCard("sona3", null, false, 3);
    drawGraph();
  }
}

resizeCanvas();

window.addEventListener("resize", () => {
  resizeCanvas();
  drawGraph();
});

setInterval(loadLiveData, 1000);
loadLiveData();
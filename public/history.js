let historyChart;
let stateChart;
let distanceChart;
let currentView = "hour";
const urlParams = new URLSearchParams(window.location.search);
const validSensors = new Set(["sona1", "sona2", "sona3"]);
const selectedSensorParam = urlParams.get("sensor");
const selectedSensor = validSensors.has(selectedSensorParam) ? selectedSensorParam : null;
const sensorIds = ["sona1", "sona2", "sona3"];
const sensorSeriesMeta = {
  sona1: { label: "Sensor 1", color: "#9FD0FF", fill: "rgba(159, 208, 255, 0.16)" },
  sona2: { label: "Sensor 2", color: "#A8FFB0", fill: "rgba(168, 255, 176, 0.16)" },
  sona3: { label: "Sensor 3", color: "#FFB3D9", fill: "rgba(255, 179, 217, 0.16)" }
};

function syncViewportVars() {
  const root = document.documentElement;
  root.style.setProperty("--app-vh", `${window.innerHeight}px`);
  root.style.setProperty("--app-vw", `${window.innerWidth}px`);
}

function parseTimestamp(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatTimeLabel(date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatHourLabel(date) {
  return date.toLocaleTimeString([], {
    hour: "numeric"
  });
}

function formatDayLabel(date) {
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });
}

function startOfHour(date) {
  const rounded = new Date(date);
  rounded.setMinutes(0, 0, 0);
  return rounded;
}

function startOfDay(date) {
  const rounded = new Date(date);
  rounded.setHours(0, 0, 0, 0);
  return rounded;
}

function averageDefined(numbers) {
  const valid = (numbers || []).filter((value) => value != null && !Number.isNaN(value));
  return average(valid);
}

function fillForward(values) {
  const filled = [];
  let lastKnown = null;

  for (const value of values) {
    if (value != null && !Number.isNaN(value)) {
      lastKnown = value;
      filled.push(value);
    } else {
      filled.push(lastKnown);
    }
  }

  return filled;
}

function finalizeBuckets(buckets) {
  const base = buckets.map((bucket) => ({
    label: bucket.label,
    sensorAverages: {
      sona1: average(bucket.sensorSounds.sona1),
      sona2: average(bucket.sensorSounds.sona2),
      sona3: average(bucket.sensorSounds.sona3)
    },
    sensorDistances: {
      sona1: average(bucket.sensorDistances.sona1),
      sona2: average(bucket.sensorDistances.sona2),
      sona3: average(bucket.sensorDistances.sona3)
    }
  }));

  const filledSounds = {};
  const filledDistances = {};

  for (const sensorId of sensorIds) {
    filledSounds[sensorId] = fillForward(base.map((bucket) => bucket.sensorAverages[sensorId]));
    filledDistances[sensorId] = fillForward(base.map((bucket) => bucket.sensorDistances[sensorId]));
  }

  return base.map((bucket, index) => {
    const sensorAverages = {};
    const sensorDistanceAverages = {};

    for (const sensorId of sensorIds) {
      sensorAverages[sensorId] = filledSounds[sensorId][index];
      sensorDistanceAverages[sensorId] = filledDistances[sensorId][index];
    }

    return {
      label: bucket.label,
      sound: averageDefined(Object.values(sensorAverages)),
      distance: averageDefined(Object.values(sensorDistanceAverages)),
      sensorAverages,
      sensorDistances: sensorDistanceAverages
    };
  });
}

function getLatestLoggedDate(rows) {
  let latest = null;

  for (const row of rows) {
    const date = parseTimestamp(row.timestamp);
    if (!date) continue;
    if (!latest || date.getTime() > latest.getTime()) {
      latest = date;
    }
  }

  return latest;
}

function average(numbers) {
  if (!numbers.length) return null;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

function stateFromSound(db) {
  if (db < 50) return "quiet";
  if (db < 70) return "medium";
  return "loud";
}

const S3_LATEST_URL = "https://sona-data-kelly.s3.amazonaws.com/latest.json";
const SEED_HISTORY_URL = "/seed-history.json";
const historyStore = window.SonaHistoryStore || null;

function loadStoredHistory() {
  if (historyStore && typeof historyStore.loadHistory === "function") {
    return historyStore.loadHistory();
  }

  try {
    const raw = localStorage.getItem("sona_history");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(rows) {
  if (historyStore && typeof historyStore.saveHistory === "function") {
    historyStore.saveHistory(rows || []);
    return;
  }

  try {
    localStorage.setItem("sona_history", JSON.stringify(rows.slice(-12000)));
  } catch {
    // localStorage full — trim and retry
    try {
      localStorage.setItem("sona_history", JSON.stringify(rows.slice(-500)));
    } catch { /* ignore */ }
  }
}

async function ensureSeededHistory() {
  if (!historyStore || typeof historyStore.ensureSeeded !== "function") return;
  try {
    await historyStore.ensureSeeded();
  } catch {
    // ignore seed load errors
  }
}

async function loadSeedRows() {
  try {
    const response = await fetch(`${SEED_HISTORY_URL}?v=${Date.now()}`);
    if (!response.ok) return [];

    const payload = await response.json();
    if (!Array.isArray(payload)) return [];

    if (historyStore && typeof historyStore.normalizeRow === "function") {
      return payload.map((row) => historyStore.normalizeRow(row)).filter(Boolean);
    }

    return payload.filter(Boolean);
  } catch {
    return [];
  }
}

function mergeRows(rows) {
  const merged = [];
  const keys = new Set();

  for (const row of rows) {
    if (!row || !row.sensor_id || !row.timestamp) continue;
    const key = `${row.sensor_id}|${row.timestamp}`;
    if (keys.has(key)) continue;
    keys.add(key);
    merged.push(row);
  }

  return merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

async function fetchAndAccumulate() {
  try {
    const response = await fetch(S3_LATEST_URL + "?t=" + Date.now());
    if (!response.ok) return;
    const payload = await response.json();

    // Normalise to array of sensor rows
    let incoming = [];
    if (Array.isArray(payload)) {
      incoming = payload.filter((r) => r && r.sensor_id);
    } else if (payload && payload.sensor_id) {
      incoming = [payload];
    } else {
      for (const row of Object.values(payload || {})) {
        if (row && row.sensor_id) incoming.push(row);
      }
    }

    const normalizedIncoming = historyStore && typeof historyStore.normalizeRow === "function"
      ? incoming.map((row) => historyStore.normalizeRow(row)).filter(Boolean)
      : incoming;

    if (!normalizedIncoming.length) return;

    if (historyStore && typeof historyStore.appendRows === "function") {
      historyStore.appendRows(normalizedIncoming);
    } else {
      const history = loadStoredHistory();
      const existingKeys = new Set(history.map((r) => `${r.sensor_id}|${r.timestamp}`));
      for (const row of normalizedIncoming) {
        const key = `${row.sensor_id}|${row.timestamp}`;
        if (!existingKeys.has(key)) {
          history.push(row);
          existingKeys.add(key);
        }
      }
      saveHistory(history);
    }
  } catch { /* network error — ignore */ }
}

async function fetchHistoryRows() {
  await ensureSeededHistory();
  // Poll S3 once more to get latest, then return accumulated local history
  await fetchAndAccumulate();
  const seedRows = await loadSeedRows();
  let rows = mergeRows(seedRows.concat(loadStoredHistory()));
  if (selectedSensor) rows = rows.filter((r) => r.sensor_id === selectedSensor);
  return rows;
}

function updatePageHeading() {
  const titleEl = document.getElementById("analysisPageTitle");
  if (!titleEl) return;

  if (selectedSensor === "sona1") {
    titleEl.textContent = "Sensor 1 Analytics";
  } else if (selectedSensor === "sona2") {
    titleEl.textContent = "Sensor 2 Analytics";
  } else if (selectedSensor === "sona3") {
    titleEl.textContent = "Sensor 3 Analytics";
  } else {
    titleEl.textContent = "Acoustic Monitoring Analytics";
  }
}

function buildHourBuckets(rows, hoursBack = 24) {
  const latestLogged = getLatestLoggedDate(rows) || new Date();
  const anchorHourStart = startOfHour(latestLogged);

  // Anchor to latest logged hour so persisted history still appears after reload.
  const endExclusive = new Date(anchorHourStart.getTime() + 60 * 60 * 1000);
  const start = new Date(endExclusive.getTime() - hoursBack * 60 * 60 * 1000);
  const bucketMap = new Map();

  for (let i = 0; i < hoursBack; i++) {
    const bucketDate = new Date(start.getTime() + i * 60 * 60 * 1000);
    bucketDate.setMinutes(0, 0, 0);
    const key = `${bucketDate.getFullYear()}-${bucketDate.getMonth()}-${bucketDate.getDate()}-${bucketDate.getHours()}`;
    bucketMap.set(key, {
      date: bucketDate,
      label: formatHourLabel(bucketDate),
      sensorSounds: { sona1: [], sona2: [], sona3: [] },
      sensorDistances: { sona1: [], sona2: [], sona3: [] }
    });
  }

  for (const row of rows) {
    const date = parseTimestamp(row.timestamp);
    if (!date || date < start || date >= endExclusive) continue;

    const bucketDate = startOfHour(date);
    const key = `${bucketDate.getFullYear()}-${bucketDate.getMonth()}-${bucketDate.getDate()}-${bucketDate.getHours()}`;
    const bucket = bucketMap.get(key);
    if (!bucket) continue;

    if (!row) continue;
    const sound = Number(row.sound_db);
    const distance = Number(row.distance_cm);

    if (!Number.isNaN(sound)) {
      if (bucket.sensorSounds[row.sensor_id]) {
        bucket.sensorSounds[row.sensor_id].push(sound);
      }
    }
    if (!Number.isNaN(distance) && distance >= 0 && bucket.sensorDistances[row.sensor_id]) {
      bucket.sensorDistances[row.sensor_id].push(distance);
    }
  }

  return finalizeBuckets(Array.from(bucketMap.values()));
}

function buildDayBuckets(rows, daysBack = 30) {
  const latestLogged = getLatestLoggedDate(rows) || new Date();
  const anchorDayStart = startOfDay(latestLogged);

  // Anchor day/month windows to latest logged day instead of current day.
  const start = new Date(anchorDayStart.getTime() - (daysBack - 1) * 24 * 60 * 60 * 1000);
  const endInclusive = new Date(anchorDayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  const bucketMap = new Map();

  for (let i = 0; i < daysBack; i++) {
    const bucketDate = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    bucketDate.setHours(0, 0, 0, 0);
    const key = `${bucketDate.getFullYear()}-${bucketDate.getMonth()}-${bucketDate.getDate()}`;
    bucketMap.set(key, {
      date: bucketDate,
      label: formatDayLabel(bucketDate),
      sensorSounds: { sona1: [], sona2: [], sona3: [] },
      sensorDistances: { sona1: [], sona2: [], sona3: [] }
    });
  }

  for (const row of rows) {
    const date = parseTimestamp(row.timestamp);
    if (!date || date < start || date > endInclusive) continue;

    const bucketDate = startOfDay(date);
    const key = `${bucketDate.getFullYear()}-${bucketDate.getMonth()}-${bucketDate.getDate()}`;
    const bucket = bucketMap.get(key);
    if (!bucket) continue;

    if (!row) continue;
    const sound = Number(row.sound_db);
    const distance = Number(row.distance_cm);

    if (!Number.isNaN(sound)) {
      if (bucket.sensorSounds[row.sensor_id]) {
        bucket.sensorSounds[row.sensor_id].push(sound);
      }
    }
    if (!Number.isNaN(distance) && distance >= 0 && bucket.sensorDistances[row.sensor_id]) {
      bucket.sensorDistances[row.sensor_id].push(distance);
    }
  }

  return finalizeBuckets(Array.from(bucketMap.values()));
}

function updateSummary(bucketedData) {
  const validSound = bucketedData.map((d) => d.sound).filter((v) => v != null && !Number.isNaN(v));
  const validDistance = bucketedData.map((d) => d.distance).filter((v) => v != null && !Number.isNaN(v));

  const avgSound = average(validSound);
  const maxSound = validSound.length ? Math.max(...validSound) : null;
  const avgDistance = average(validDistance);

  const stateCounts = { quiet: 0, medium: 0, loud: 0 };
  for (const s of validSound) {
    stateCounts[stateFromSound(s)]++;
  }

  let dominantState = "--";
  if (validSound.length) {
    let bestCount = -1;
    for (const [state, count] of Object.entries(stateCounts)) {
      if (count > bestCount) {
        dominantState = state;
        bestCount = count;
      }
    }
  }

  document.getElementById("avgSound").textContent = avgSound == null ? "--" : `${avgSound.toFixed(1)} dB`;
  document.getElementById("maxSound").textContent = maxSound == null ? "--" : `${maxSound.toFixed(1)} dB`;
  document.getElementById("avgDistance").textContent = avgDistance == null ? "--" : `${avgDistance.toFixed(1)} cm`;
  document.getElementById("dominantState").textContent = dominantState === "--" ? "--" : dominantState.toUpperCase();

  renderStateChart(stateCounts);
  renderDistanceChart(bucketedData);
}

function getChartConfig(view, labels, values, datasetsOverride = null) {
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: "#D8E2FF" } }
    },
    scales: {
      x: {
        ticks: {
          color: "#C8D3F7",
          maxRotation: view === "hour" ? 0 : 45,
          minRotation: view === "hour" ? 0 : 45
        },
        grid: { color: "rgba(255,255,255,0.06)" }
      },
      y: {
        ticks: { color: "#C8D3F7" },
        grid: { color: "rgba(255,255,255,0.08)" },
        title: { display: true, text: "Estimated dB", color: "#D8E2FF" }
      }
    }
  };

  if (view === "day") {
    return {
      type: "bar",
      data: {
        labels,
        datasets: datasetsOverride || [{
          label: "Daily Avg Estimated dB",
          data: values,
          borderWidth: 1,
          borderRadius: 8,
          backgroundColor: "rgba(159, 208, 255, 0.65)",
          borderColor: "rgba(191, 228, 255, 1)"
        }]
      },
      options: commonOptions
    };
  }

  if (view === "month") {
    return {
      type: "line",
      data: {
        labels,
        datasets: datasetsOverride || [{
          label: "Daily Avg Estimated dB (Month)",
          data: values,
          borderColor: "#9FD0FF",
          backgroundColor: "rgba(159, 208, 255, 0.18)",
          fill: true,
          spanGaps: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4
        }]
      },
      options: commonOptions
    };
  }

  return {
    type: "line",
    data: {
      labels,
      datasets: datasetsOverride || [{
        label: "Hourly Avg Estimated dB",
        data: values,
        borderColor: "#9FD0FF",
        backgroundColor: "rgba(159, 208, 255, 0.18)",
        fill: true,
        spanGaps: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4
      }]
    },
    options: commonOptions
  };
}

function renderStateChart(stateCounts) {
  const ctx = document.getElementById("stateChart").getContext("2d");
  if (stateChart) stateChart.destroy();

  stateChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Quiet", "Medium", "Loud"],
      datasets: [{
        data: [stateCounts.quiet, stateCounts.medium, stateCounts.loud],
        backgroundColor: [
          "rgba(160, 233, 185, 0.85)",
          "rgba(244, 211, 94, 0.85)",
          "rgba(255, 107, 107, 0.85)"
        ],
        borderColor: [
          "rgba(160, 233, 185, 1)",
          "rgba(244, 211, 94, 1)",
          "rgba(255, 107, 107, 1)"
        ],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#D8E2FF" } } }
    }
  });
}

function renderDistanceChart(bucketedData) {
  const ctx = document.getElementById("distanceChart").getContext("2d");
  if (distanceChart) distanceChart.destroy();

  distanceChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: bucketedData.map((d) => d.label),
      datasets: [{
        label: "Distance (cm)",
        data: bucketedData.map((d) => d.distance),
        borderColor: "#C5B6FF",
        backgroundColor: "rgba(197, 182, 255, 0.15)",
        fill: true,
        spanGaps: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#D8E2FF" } } },
      scales: {
        x: {
          ticks: {
            color: "#C8D3F7",
            maxRotation: 0,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6
          },
          grid: { color: "rgba(255,255,255,0.06)" }
        },
        y: {
          ticks: { color: "#C8D3F7" },
          grid: { color: "rgba(255,255,255,0.08)" }
        }
      }
    }
  });
}

function updateTitle(view) {
  const title = document.getElementById("chartTitle");
  const scopeLabel = selectedSensor ? "Sensor Log" : "All Sensors";
  if (view === "hour") {
    title.textContent = `${scopeLabel} — Hourly View (Last 24 Hours)`;
  } else if (view === "day") {
    title.textContent = `${scopeLabel} — Daily Average View (Last 7 Days)`;
  } else {
    title.textContent = `${scopeLabel} — Daily Trend Across Month`;
  }
}

async function loadHistory(view = "hour") {
  try {
    const rows = await fetchHistoryRows();
    let bucketedData = [];

    if (view === "hour") {
      bucketedData = buildHourBuckets(rows, 24);
    } else if (view === "day") {
      bucketedData = buildDayBuckets(rows, 7);
    } else {
      bucketedData = buildDayBuckets(rows, 30);
    }

    const labels = bucketedData.map((d) => d.label);
    const values = bucketedData.map((d) => d.sound);
    let datasetsOverride = null;

    if (!selectedSensor) {
      datasetsOverride = sensorIds.map((sensorId) => ({
        label: sensorSeriesMeta[sensorId].label,
        data: bucketedData.map((d) => d.sensorAverages[sensorId]),
        borderColor: sensorSeriesMeta[sensorId].color,
        backgroundColor: sensorSeriesMeta[sensorId].fill,
        fill: false,
        spanGaps: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2
      }));
    }

    updateSummary(bucketedData);
    updateTitle(view);

    const ctx = document.getElementById("historyChart").getContext("2d");
    if (historyChart) historyChart.destroy();
    historyChart = new Chart(ctx, getChartConfig(view, labels, values, datasetsOverride));
  } catch (error) {
    console.error("[SONA] History load error:", error);

    if (historyChart) {
      historyChart.destroy();
      historyChart = null;
    }

    document.getElementById("avgSound").textContent = "--";
    document.getElementById("maxSound").textContent = "--";
    document.getElementById("avgDistance").textContent = "--";
    document.getElementById("dominantState").textContent = "--";
  }
}

function setActiveTab(view) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
}

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    currentView = button.dataset.view;
    setActiveTab(currentView);
    loadHistory(currentView);
  });
});

updatePageHeading();
syncViewportVars();
loadHistory(currentView);
setInterval(() => loadHistory(currentView), 5000);
window.addEventListener("resize", () => {
  syncViewportVars();
  if (historyChart) historyChart.resize();
  if (stateChart) stateChart.resize();
  if (distanceChart) distanceChart.resize();
});

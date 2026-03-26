let historyChart;
let stateChart;
let distanceChart;
let currentView = "hour";
const urlParams = new URLSearchParams(window.location.search);
const validSensors = new Set(["sona1", "sona2", "sona3"]);
const selectedSensorParam = urlParams.get("sensor");
const selectedSensor = validSensors.has(selectedSensorParam) ? selectedSensorParam : null;

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

function average(numbers) {
  if (!numbers.length) return null;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

function stateFromSound(db) {
  if (db < 50) return "quiet";
  if (db < 70) return "medium";
  return "loud";
}

async function fetchHistoryRows() {
  const query = selectedSensor
    ? `/api/history?sensor=${encodeURIComponent(selectedSensor)}&limit=5000&order=asc`
    : "/api/history?limit=5000&order=asc";

  const response = await fetch(query);
  if (!response.ok) {
    throw new Error(`Failed to fetch history (${response.status})`);
  }

  const payload = await response.json();
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  return [];
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
  const now = new Date();
  const currentHourStart = new Date(now);
  currentHourStart.setMinutes(0, 0, 0);

  // Use only completed hours so values roll forward once per hour.
  const endExclusive = currentHourStart;
  const start = new Date(endExclusive.getTime() - hoursBack * 60 * 60 * 1000);
  const bucketMap = new Map();

  for (let i = 0; i < hoursBack; i++) {
    const bucketDate = new Date(start.getTime() + i * 60 * 60 * 1000);
    bucketDate.setMinutes(0, 0, 0);
    const key = `${bucketDate.getFullYear()}-${bucketDate.getMonth()}-${bucketDate.getDate()}-${bucketDate.getHours()}`;
    bucketMap.set(key, { date: bucketDate, sounds: [], distances: [] });
  }

  for (const row of rows) {
    const date = parseTimestamp(row.timestamp);
    if (!date || date < start || date >= endExclusive) continue;

    const bucketDate = new Date(date);
    bucketDate.setMinutes(0, 0, 0);
    const key = `${bucketDate.getFullYear()}-${bucketDate.getMonth()}-${bucketDate.getDate()}-${bucketDate.getHours()}`;
    const bucket = bucketMap.get(key);
    if (!bucket) continue;

    const sound = Number(row.sound);
    const distance = Number(row.distance_cm);

    if (!Number.isNaN(sound)) bucket.sounds.push(sound);
    if (!Number.isNaN(distance) && distance >= 0) bucket.distances.push(distance);
  }

  return Array.from(bucketMap.values()).map((bucket) => ({
    label: formatHourLabel(bucket.date),
    sound: average(bucket.sounds),
    distance: average(bucket.distances)
  }));
}

function buildDayBuckets(rows, daysBack = 30) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // Include today in day/month views so users can track intra-day movement.
  const start = new Date(todayStart.getTime() - (daysBack - 1) * 24 * 60 * 60 * 1000);
  const endInclusive = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  const bucketMap = new Map();

  for (let i = 0; i < daysBack; i++) {
    const bucketDate = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    bucketDate.setHours(0, 0, 0, 0);
    const key = `${bucketDate.getFullYear()}-${bucketDate.getMonth()}-${bucketDate.getDate()}`;
    bucketMap.set(key, { date: bucketDate, sounds: [], distances: [] });
  }

  for (const row of rows) {
    const date = parseTimestamp(row.timestamp);
    if (!date || date < start || date > endInclusive) continue;

    const bucketDate = new Date(date);
    bucketDate.setHours(0, 0, 0, 0);
    const key = `${bucketDate.getFullYear()}-${bucketDate.getMonth()}-${bucketDate.getDate()}`;
    const bucket = bucketMap.get(key);
    if (!bucket) continue;

    const sound = Number(row.sound);
    const distance = Number(row.distance_cm);

    if (!Number.isNaN(sound)) bucket.sounds.push(sound);
    if (!Number.isNaN(distance) && distance >= 0) bucket.distances.push(distance);
  }

  return Array.from(bucketMap.values()).map((bucket) => ({
    label: formatDayLabel(bucket.date),
    sound: average(bucket.sounds),
    distance: average(bucket.distances)
  }));
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

function getChartConfig(view, labels, values) {
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
        datasets: [{
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
        datasets: [{
          label: "Daily Avg Estimated dB (Month)",
          data: values,
          borderColor: "#9FD0FF",
          backgroundColor: "rgba(159, 208, 255, 0.18)",
          fill: true,
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
      datasets: [{
        label: "Hourly Avg Estimated dB",
        data: values,
        borderColor: "#9FD0FF",
        backgroundColor: "rgba(159, 208, 255, 0.18)",
        fill: true,
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
  if (view === "hour") {
    title.textContent = "Estimated Sound Levels — Hourly View (Last 24 Hours)";
  } else if (view === "day") {
    title.textContent = "Estimated Sound Levels — Daily Average View (Last 7 Days)";
  } else {
    title.textContent = "Estimated Sound Levels — Daily Trend Across Month";
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

    updateSummary(bucketedData);
    updateTitle(view);

    const ctx = document.getElementById("historyChart").getContext("2d");
    if (historyChart) historyChart.destroy();
    historyChart = new Chart(ctx, getChartConfig(view, labels, values));
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

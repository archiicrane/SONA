function formatTimestamp(timestamp) {
  if (!timestamp) return "--";
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString();
}

function stateFromSound(db) {
  if (db < 50) return "QUIET";
  if (db < 70) return "MEDIUM";
  return "LOUD";
}

function sensorLabel(sensorId) {
  if (sensorId === "sona1") return "Sensor 1";
  if (sensorId === "sona2") return "Sensor 2";
  if (sensorId === "sona3") return "Sensor 3";
  return sensorId || "--";
}

function sensorBorderColor(sensorId) {
  if (sensorId === "sona1") return "#9FD0FF";
  if (sensorId === "sona2") return "#A8FFB0";
  if (sensorId === "sona3") return "#FFB3D9";
  return "#D8E2FF";
}

function prettyDirectionLabel(label) {
  if (!label || label === "UNKNOWN") return "Unknown";
  return String(label)
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function loadRawData() {
  const tbody = document.querySelector("#rawTable tbody");

  try {
    const response = await fetch("/api/raw?limit=100");
    if (!response.ok) throw new Error(`Failed to fetch raw data (${response.status})`);

    const rows = await response.json();
    const items = Array.isArray(rows) ? rows : [];
    tbody.innerHTML = "";

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="5">No data yet</td></tr>`;
      return;
    }

    for (const item of items) {
      if (!item) continue;
      const sound = Number(item.sound_db);
      const distance = Number(item.distance_cm);
      const state = item.state || stateFromSound(sound);
      const row = document.createElement("tr");
      row.style.borderLeft = `4px solid ${sensorBorderColor(item.sensor_id)}`;

      row.innerHTML = `
        <td>${formatTimestamp(item.timestamp)}</td>
        <td>${sensorLabel(item.sensor_id)}</td>
        <td>${Number.isFinite(sound) ? sound.toFixed(1) + " dB" : "--"}</td>
        <td>${Number.isFinite(distance) ? distance.toFixed(1) + " cm" : "--"}</td>
        <td>${state ? state.toUpperCase() : "--"}</td>
      `;

      tbody.appendChild(row);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5">Error loading data</td></tr>`;
    console.error("[SONA] Raw data load error:", err);
  }
}

loadRawData();
setInterval(loadRawData, 3000);
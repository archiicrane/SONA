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

async function loadRawData() {
  const tbody = document.querySelector("#rawTable tbody");

  try {
    const response = await fetch("/api/history?limit=1000&order=desc");
    if (!response.ok) throw new Error(`Failed to fetch history (${response.status})`);

    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload.rows) ? payload.rows : [];
    tbody.innerHTML = "";

    const newestFirst = [...rows].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (!newestFirst.length) {
      tbody.innerHTML = `<tr><td colspan="5">No saved history yet</td></tr>`;
      return;
    }

    for (const item of newestFirst) {
      const sound = Number(item.sound);
      const distance = Number(item.distance_cm);
      const row = document.createElement("tr");
      row.style.borderLeft = `4px solid ${sensorBorderColor(item.sensor)}`;

      row.innerHTML = `
        <td>${formatTimestamp(item.timestamp)}</td>
        <td>${sensorLabel(item.sensor)}</td>
        <td>${Number.isFinite(sound) ? sound.toFixed(1) + " dB" : "--"}</td>
        <td>${item.sound_state ? item.sound_state.toUpperCase() : stateFromSound(sound)}</td>
        <td>${Number.isFinite(distance) ? distance.toFixed(1) + " cm" : "--"}</td>
      `;

      tbody.appendChild(row);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5">Error loading saved data</td></tr>`;
    console.error("[SONA] Raw data load error:", err);
  }
}

loadRawData();
setInterval(loadRawData, 3000);
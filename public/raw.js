function formatTime(timestamp) {
  if (!timestamp) return "--";
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleTimeString();
}

function stateFromSound(db) {
  if (db < 50) return "QUIET";
  if (db < 70) return "MEDIUM";
  return "LOUD";
}

async function loadRawData() {
  const tbody = document.querySelector("#rawTable tbody");

  try {
    const response = await fetch("/api/arduino");
    if (!response.ok) throw new Error("Failed to fetch");

    const data = await response.json();

    // CLEAR TABLE
    tbody.innerHTML = "";

    // LOOP THROUGH EACH SENSOR
    for (const [sensorId, sensorData] of Object.entries(data)) {
      const sound = Number(sensorData.sound);
      const distance = Number(sensorData.distance);
      const timestamp = sensorData.updatedAt;

      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${formatTime(timestamp)}</td>
        <td>${!isNaN(sound) ? sound.toFixed(1) + " dB" : "--"}</td>
        <td>${!isNaN(sound) ? stateFromSound(sound) : "--"}</td>
        <td>${!isNaN(distance) ? distance.toFixed(1) + " cm" : "--"}</td>
      `;

      // OPTIONAL: color rows by sensor
      if (sensorId === "sona1") row.style.borderLeft = "4px solid #9FD0FF";
      if (sensorId === "sona2") row.style.borderLeft = "4px solid #A8FFB0";
      if (sensorId === "sona3") row.style.borderLeft = "4px solid #FFB3D9";

      tbody.appendChild(row);
    }

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4">Error loading data</td></tr>`;
    console.error(err);
  }
}

// LOAD + AUTO REFRESH
loadRawData();
setInterval(loadRawData, 1000);
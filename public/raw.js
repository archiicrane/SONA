async function loadRawData() {
  try {
    const response = await fetch("/api/arduino");
    const rows = await response.json();

    const tbody = document.querySelector("#rawTable tbody");
    tbody.innerHTML = "";

    rows.forEach((row) => {
      const tr = document.createElement("tr");

      const sound =
        row.sound == null || Number.isNaN(Number(row.sound))
          ? "--"
          : `${Number(row.sound).toFixed(1)}`;

      const distance =
        row.distance_cm == null || Number.isNaN(Number(row.distance_cm))
          ? "--"
          : `${Number(row.distance_cm).toFixed(1)}`;

      tr.innerHTML = `
        <td>${new Date(row.timestamp).toLocaleString()}</td>
        <td>${sound}</td>
        <td>${row.sound_state || "--"}</td>
        <td>${distance}</td>
      `;

      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error("Failed to load raw data:", error);
  }
}

loadRawData();
const soundHistory = [];
const maxPoints = 120;

const canvas = document.getElementById("waveCanvas");
const ctx = canvas.getContext("2d");
const statusBox1 = document.getElementById("statusBox1");

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}

function drawGraph() {
  const w = canvas.width;
  const h = canvas.height;

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

  if (soundHistory.length < 2) return;

  ctx.strokeStyle = "#9FD0FF";
  ctx.lineWidth = 3;
  ctx.beginPath();

  const minDb = 35;
  const maxDb = 85;

  for (let i = 0; i < soundHistory.length; i++) {
    const x = (i / (maxPoints - 1)) * w;

    let normalized = (soundHistory[i] - minDb) / (maxDb - minDb);
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

function setStatus(box, state, fallbackText = "NO DATA") {
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

async function loadLiveData() {
  try {
    const response = await fetch("/api/live");
    if (!response.ok) throw new Error("Live fetch failed");

    const data = await response.json();

    const soundNumber = Number(data.sound);
    const distanceNumber = Number(data.distance_cm);

    if (!Number.isNaN(soundNumber)) {
      document.getElementById("soundValue").textContent = `${soundNumber.toFixed(1)} dB`;

      soundHistory.push(soundNumber);
      if (soundHistory.length > maxPoints) {
        soundHistory.shift();
      }
    } else {
      document.getElementById("soundValue").textContent = "--";
    }

    if (Number.isNaN(distanceNumber) || distanceNumber < 0) {
      document.getElementById("distanceValue").textContent = "--";
    } else {
      document.getElementById("distanceValue").textContent = `${distanceNumber.toFixed(1)} cm`;
    }

    setStatus(statusBox1, data.sound_state, "WAITING");
    drawGraph();
  } catch (error) {
    document.getElementById("soundValue").textContent = "--";
    document.getElementById("distanceValue").textContent = "--";
    setStatus(statusBox1, null, "NO DATA");
  }
}

resizeCanvas();

window.addEventListener("resize", () => {
  resizeCanvas();
  drawGraph();
});

setInterval(loadLiveData, 300);
loadLiveData();
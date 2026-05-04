(function initSonaHistoryStore() {
  const HISTORY_KEY = "sona_history";
  const MAX_HISTORY = 12000;
  const SEED_URL = "/seed-history.json";
  const SEED_VERSION = "2026-05-seed-v2";
  const SEED_FLAG_KEY = "sona_history_seed_version";
  const BOOTSTRAP_MIN_ROWS = 700;

  function stateFromSound(db) {
    if (db < 50) return "quiet";
    if (db < 70) return "medium";
    return "loud";
  }

  function normalizeRow(row) {
    if (!row || typeof row !== "object") return null;

    const sensorId = row.sensor_id || row.sensor;
    if (!sensorId) return null;

    const soundValue = Number(row.sound_db ?? row.sound);
    const distanceValue = Number(row.distance_cm);
    const timestamp = row.timestamp;

    if (!timestamp) return null;

    const normalized = {
      sensor_id: sensorId,
      sound_db: Number.isFinite(soundValue) ? soundValue : null,
      distance_cm: Number.isFinite(distanceValue) ? distanceValue : null,
      timestamp,
      sound_state: row.sound_state || row.state || (Number.isFinite(soundValue) ? stateFromSound(soundValue) : "unknown")
    };

    normalized.state = normalized.sound_state;
    return normalized;
  }

  function dedupeRows(rows) {
    const out = [];
    const keys = new Set();

    for (const rawRow of rows) {
      const row = normalizeRow(rawRow);
      if (!row) continue;
      const key = `${row.sensor_id}|${row.timestamp}`;
      if (keys.has(key)) continue;
      keys.add(key);
      out.push(row);
    }

    return out;
  }

  function sortRows(rows) {
    return rows.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return dedupeRows(parsed);
    } catch {
      return [];
    }
  }

  function saveHistory(rows) {
    const cleaned = sortRows(dedupeRows(rows)).slice(-MAX_HISTORY);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(cleaned));
    } catch {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(cleaned.slice(-2000)));
      } catch {
        // ignore storage overflow
      }
    }
    return cleaned;
  }

  function appendRows(incoming) {
    const existing = loadHistory();
    return saveHistory(existing.concat(incoming || []));
  }

  async function ensureSeeded() {
    try {
      const current = loadHistory();

      const response = await fetch(`${SEED_URL}?v=${encodeURIComponent(SEED_VERSION)}`);
      if (!response.ok) return current;

      const payload = await response.json();
      if (!Array.isArray(payload) || !payload.length) return current;

      const seedRows = dedupeRows(payload);
      const merged = dedupeRows(current.concat(seedRows));

      // Re-save when the cached history is sparse, when the seed actually adds
      // rows, or when the browser still carries an older seed marker.
      if (
        current.length < BOOTSTRAP_MIN_ROWS
        || merged.length !== current.length
        || localStorage.getItem(SEED_FLAG_KEY) !== SEED_VERSION
      ) {
        saveHistory(merged);
      }

      localStorage.setItem(SEED_FLAG_KEY, SEED_VERSION);
      return merged;
    } catch {
      return loadHistory();
    }
  }

  window.SonaHistoryStore = {
    HISTORY_KEY,
    MAX_HISTORY,
    normalizeRow,
    loadHistory,
    saveHistory,
    appendRows,
    ensureSeeded
  };
})();

// AWS-backed SONA API — reads from DynamoDB via awsClient
const aws = require("./_lib/awsClient");

function normalize(row) {
  return {
    sensor_id: row.sensor_id,
    timestamp: row.timestamp,
    distance_cm: row.distance_cm,
    sound_db: row.sound_db,
    state: row.state || null
  };
}

module.exports = async function sonaHandler(req, res) {
  try {
    const url = req.url.split("?")[0];
    // Support both Express direct routes (/api/live) and Vercel rewrites (?route=live)
    const route = req.query.route
      || (url.endsWith("/live") ? "live" : url.endsWith("/history") ? "history" : url.endsWith("/raw") ? "raw" : null);

    if (route === "live") {
      const rows = await aws.getLatestReadings();
      return res.json(rows.map(normalize));
    }

    if (route === "history") {
      const sensor = req.query.sensor || null;
      const range = req.query.range || null;
      const rows = await aws.getHistory(sensor, range);
      return res.json(rows.map(normalize));
    }

    if (route === "raw") {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const rows = await aws.getRaw(limit);
      return res.json(rows.map(normalize));
    }

    return res.status(404).json({ error: "Unknown API route" });
  } catch (error) {
    console.error("[SONA] API error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

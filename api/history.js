const store = require("./_lib/sonaStore");

module.exports = function historyHandler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const data = store.getHistory({
      sensor: req.query && req.query.sensor,
      limit: req.query && req.query.limit,
      order: req.query && req.query.order
    });

    return res.status(200).json({ ok: true, ...data });
  } catch (error) {
    console.error("[SONA] /api/history failed:", error);
    return res.status(500).json({ ok: false, error: "Internal server error", rows: [] });
  }
};
